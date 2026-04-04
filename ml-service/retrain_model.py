#!/usr/bin/env python3
"""
===========================================================================
KAAYKO PADDLE SCORE — AUTOMATED RETRAINING PIPELINE
===========================================================================

Triggered by Cloud Build on a weekly schedule (or manually).
Reads labelled feedback from Firestore, trains an XGBoost regressor with
temporal cross-validation, evaluates against a quality gate, and — only if
the gate passes — uploads the new model to GCS as current.pkl.

Usage
-----
  python retrain_model.py [--min-samples N] [--mae-gate F] [--dry-run]

Environment vars (set in Cloud Build substitutions)
----------------------------------------------------
  GCP_PROJECT        Google Cloud project ID
  ML_MODEL_BUCKET    GCS bucket name           (default: kaayko-ml-models)
  ML_MODEL_OBJECT    GCS object path           (default: paddle-score/current.pkl)
  FEEDBACK_COLLECTION  Firestore collection    (default: paddle_predictions_feedback)
===========================================================================
"""

import os
import sys
import argparse
import tempfile
import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import joblib

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
log = logging.getLogger('retrain')

# ── Config ─────────────────────────────────────────────────────────────────
GCS_BUCKET   = os.environ.get('ML_MODEL_BUCKET',      'kaayko-ml-models')
GCS_OBJECT   = os.environ.get('ML_MODEL_OBJECT',      'paddle-score/current.pkl')
GCS_ARCHIVE  = os.environ.get('ML_MODEL_ARCHIVE_DIR', 'paddle-score/archive')
FB_COLLECTION = os.environ.get('FEEDBACK_COLLECTION', 'paddle_predictions_feedback')
GCP_PROJECT   = os.environ.get('GCP_PROJECT', None)

FEATURE_COLS = [
    'latitude', 'longitude', 'hour', 'month', 'day_of_week', 'day_of_year',
    'is_weekend', 'temperature', 'feelsLike', 'windSpeed', 'gustSpeed',
    'windDegree', 'humidity', 'uvIndex', 'visibility', 'cloudCover',
    'pressure', 'precipChance', 'precipMM',
    'temp_category', 'wind_category', 'uv_category',
    'isMorning', 'isNoon', 'isEvening',
]
TARGET_COL = 'actualScore'


# ── Data loading ────────────────────────────────────────────────────────────

def load_feedback_from_firestore(min_samples: int) -> pd.DataFrame:
    """Pull labelled feedback rows from Firestore."""
    log.info(f'Loading feedback from Firestore collection: {FB_COLLECTION}')
    from google.cloud import firestore  # type: ignore
    db = firestore.Client(project=GCP_PROJECT)
    docs = db.collection(FB_COLLECTION).stream()

    rows = []
    for doc in docs:
        d = doc.to_dict()
        if d.get('actualScore') is None:
            continue
        conditions = d.get('conditions', {})
        ts = d.get('timestamp')
        if hasattr(ts, 'timestamp'):
            ts = ts.timestamp()
        elif isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts).timestamp()
            except Exception:
                ts = 0.0

        row = {
            'timestamp':    float(ts or 0),
            'actualScore':  float(d['actualScore']),
            'latitude':     float(d.get('latitude') or conditions.get('latitude') or 30.0),
            'longitude':    float(d.get('longitude') or conditions.get('longitude') or -97.0),
            'temperature':  float(conditions.get('temperature') or 20),
            'feelsLike':    float(conditions.get('feelsLike') or conditions.get('temperature') or 20),
            'windSpeed':    float(conditions.get('windSpeed') or 5),
            'gustSpeed':    float(conditions.get('gustSpeed') or conditions.get('windSpeed', 5) * 1.3),
            'windDegree':   float(conditions.get('windDegree') or 180),
            'humidity':     float(conditions.get('humidity') or 50),
            'uvIndex':      float(conditions.get('uvIndex') or 5),
            'visibility':   float(conditions.get('visibility') or 10),
            'cloudCover':   float(conditions.get('cloudCover') or 50),
            'pressure':     float(conditions.get('pressure') or 1013),
            'precipChance': float(conditions.get('precipChance') or 0),
            'precipMM':     float(conditions.get('precipMM') or 0),
        }
        rows.append(row)

    if len(rows) < min_samples:
        raise ValueError(
            f'Only {len(rows)} labelled samples found (need ≥{min_samples}). '
            'Not enough data to retrain — skipping.'
        )

    df = pd.DataFrame(rows).sort_values('timestamp').reset_index(drop=True)
    log.info(f'Loaded {len(df)} feedback samples')

    # Derived time features
    df['datetime']   = pd.to_datetime(df['timestamp'], unit='s', utc=True)
    df['hour']       = df['datetime'].dt.hour
    df['month']      = df['datetime'].dt.month
    df['day_of_week'] = df['datetime'].dt.dayofweek
    df['day_of_year'] = df['datetime'].dt.dayofyear
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
    df['isMorning']  = ((df['hour'] >= 7) & (df['hour'] <= 9)).astype(int)
    df['isNoon']     = ((df['hour'] >= 12) & (df['hour'] <= 14)).astype(int)
    df['isEvening']  = ((df['hour'] >= 17) & (df['hour'] <= 19)).astype(int)

    # Categorical buckets
    df['temp_category'] = pd.cut(df['temperature'], bins=[-999, 10, 20, 30, 999],
                                  labels=[0, 1, 2, 3]).astype(int)
    df['wind_category'] = pd.cut(df['windSpeed'], bins=[-1, 10, 20, 999],
                                  labels=[0, 1, 2]).astype(int)
    df['uv_category']   = pd.cut(df['uvIndex'], bins=[-1, 3, 6, 8, 999],
                                  labels=[0, 1, 2, 3]).astype(int)

    return df


# ── Model training ──────────────────────────────────────────────────────────

def build_pipeline() -> Pipeline:
    xgb_model = xgb.XGBRegressor(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        objective='reg:squarederror',
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=20,
    )
    return Pipeline([
        ('scaler', StandardScaler()),
        ('model',  xgb_model),
    ])


def temporal_cross_validate(df: pd.DataFrame, n_splits: int = 5):
    """TimeSeriesSplit CV — respects temporal ordering, no data leakage."""
    X = df[FEATURE_COLS].values
    y = df[TARGET_COL].values

    tscv = TimeSeriesSplit(n_splits=n_splits)
    maes, rmses, biases = [], [], []

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]

        pipe = build_pipeline()
        # XGBoost needs eval_set without pipeline wrapper for early stopping
        xgb_model = pipe.named_steps['model']
        scaler    = pipe.named_steps['scaler']

        X_train_s = scaler.fit_transform(X_train)
        X_val_s   = scaler.transform(X_val)

        xgb_model.fit(
            X_train_s, y_train,
            eval_set=[(X_val_s, y_val)],
            verbose=False,
        )

        preds = xgb_model.predict(X_val_s)
        preds = np.clip(preds, 1.0, 5.0)

        mae  = mean_absolute_error(y_val, preds)
        rmse = np.sqrt(mean_squared_error(y_val, preds))
        bias = float(np.mean(preds - y_val))   # positive = over-predicting

        maes.append(mae); rmses.append(rmse); biases.append(bias)
        log.info(f'  Fold {fold+1}: MAE={mae:.3f}  RMSE={rmse:.3f}  bias={bias:+.3f}')

    return {
        'mae':  float(np.mean(maes)),
        'rmse': float(np.mean(rmses)),
        'bias': float(np.mean(biases)),
        'folds': n_splits,
    }


def train_final_model(df: pd.DataFrame) -> Pipeline:
    """Train on all available data for the production model."""
    X = df[FEATURE_COLS].values
    y = df[TARGET_COL].values

    pipe = build_pipeline()
    scaler    = pipe.named_steps['scaler']
    xgb_model = pipe.named_steps['model']

    X_s = scaler.fit_transform(X)
    # No eval_set on final train — use all data
    xgb_model.set_params(early_stopping_rounds=None)
    xgb_model.fit(X_s, y)

    log.info(f'Final model trained on {len(df)} samples, '
             f'{xgb_model.best_ntree_limit or xgb_model.n_estimators} trees')
    return pipe


# ── GCS upload / archive ────────────────────────────────────────────────────

def upload_to_gcs(local_path: str, gcs_object: str):
    from google.cloud import storage  # type: ignore
    client = storage.Client(project=GCP_PROJECT)
    bucket = client.bucket(GCS_BUCKET)
    blob   = bucket.blob(gcs_object)
    blob.upload_from_filename(local_path)
    size_mb = os.path.getsize(local_path) / (1024 * 1024)
    log.info(f'☁️  Uploaded {local_path} ({size_mb:.1f} MB) → gs://{GCS_BUCKET}/{gcs_object}')


def archive_current_model():
    """Copy current.pkl → archive/<timestamp>.pkl before overwriting."""
    try:
        from google.cloud import storage  # type: ignore
        client = storage.Client(project=GCP_PROJECT)
        bucket = client.bucket(GCS_BUCKET)
        src    = bucket.blob(GCS_OBJECT)
        if not src.exists():
            return
        ts      = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        archive = f'{GCS_ARCHIVE}/{ts}.pkl'
        bucket.copy_blob(src, bucket, archive)
        log.info(f'📦 Archived current model → gs://{GCS_BUCKET}/{archive}')
    except Exception as e:
        log.warning(f'Archive step failed (non-fatal): {e}')


# ── Entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Retrain Kaayko paddle-score model')
    parser.add_argument('--min-samples', type=int, default=50,
                        help='Minimum feedback rows required to retrain (default: 50)')
    parser.add_argument('--mae-gate', type=float, default=0.7,
                        help='Maximum allowed MAE before rejecting new model (default: 0.7)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Train + evaluate but do NOT upload to GCS')
    args = parser.parse_args()

    log.info('═' * 60)
    log.info('KAAYKO PADDLE SCORE — RETRAINING PIPELINE')
    log.info(f'  min_samples={args.min_samples}  mae_gate={args.mae_gate}  dry_run={args.dry_run}')
    log.info('═' * 60)

    # 1. Load data
    df = load_feedback_from_firestore(args.min_samples)

    # 2. Cross-validate
    log.info('Running temporal cross-validation …')
    cv_metrics = temporal_cross_validate(df)
    log.info(f'CV results → MAE={cv_metrics["mae"]:.3f}  RMSE={cv_metrics["rmse"]:.3f}  bias={cv_metrics["bias"]:+.3f}')

    # 3. Quality gate
    if cv_metrics['mae'] > args.mae_gate:
        log.error(
            f'Quality gate FAILED: CV MAE {cv_metrics["mae"]:.3f} > threshold {args.mae_gate}. '
            'Model not deployed.'
        )
        sys.exit(1)
    log.info(f'Quality gate PASSED ✅')

    # 4. Train final model on all data
    log.info('Training final model on full dataset …')
    pipeline = train_final_model(df)

    # Bundle metadata alongside model
    model_bundle = {
        'model':        pipeline,
        'feature_names': FEATURE_COLS,
        'scaler':       None,   # scaler is inside the pipeline
        'label_encoders': {},
        'cv_metrics':   cv_metrics,
        'trained_at':   datetime.now(timezone.utc).isoformat(),
        'n_samples':    len(df),
        'format':       'xgboost-pipeline',
    }

    # 5. Save locally
    with tempfile.NamedTemporaryFile(suffix='.pkl', delete=False) as f:
        local_path = f.name
    joblib.dump(model_bundle, local_path, compress=3)
    size_mb = os.path.getsize(local_path) / (1024 * 1024)
    log.info(f'Model saved locally: {local_path} ({size_mb:.1f} MB)')

    if args.dry_run:
        log.info('DRY RUN — skipping GCS upload.')
        return

    # 6. Archive existing model, then upload new one
    archive_current_model()
    upload_to_gcs(local_path, GCS_OBJECT)

    log.info('═' * 60)
    log.info('RETRAINING COMPLETE — new model is live on GCS')
    log.info(f'  CV MAE={cv_metrics["mae"]:.3f}  RMSE={cv_metrics["rmse"]:.3f}  bias={cv_metrics["bias"]:+.3f}')
    log.info(f'  Samples: {len(df)}  Features: {len(FEATURE_COLS)}')
    log.info('═' * 60)


if __name__ == '__main__':
    main()
