"""
Kaayko ML Prediction Service - Cloud Run
Universal format handler — GCS model loading, real feature pass-through,
Firestore prediction logging.
"""
import os
import json
import threading
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging

from predict_konditions import predict_paddle_rating

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ── Firestore logging (optional — fails silently if not configured) ────────

def _log_prediction_async(payload: dict):
    """Write a prediction log entry to Firestore in a background thread."""
    try:
        from google.cloud import firestore  # type: ignore
        db = firestore.Client()
        db.collection('paddle_predictions_log').add({
            **payload,
            'serverTimestamp': firestore.SERVER_TIMESTAMP,
        })
    except Exception as e:
        logger.warning(f'Prediction log write failed (non-fatal): {e}')


def log_prediction(request_data: dict, result: dict, source: str):
    """Fire-and-forget Firestore write so it never slows down the response."""
    payload = {
        'spotId':          request_data.get('location_id', request_data.get('spotId', 'unknown')),
        'latitude':        request_data.get('latitude'),
        'longitude':       request_data.get('longitude'),
        'predictedRating': result.get('rating'),
        'predictionSource': result.get('predictionSource', source),
        'mlModelUsed':     result.get('mlModelUsed', False),
        'features': {
            'temperature':    request_data.get('temperature'),
            'windSpeed':      request_data.get('windSpeed'),
            'gustSpeed':      request_data.get('gustSpeed'),
            'windDirection':  request_data.get('windDirection'),
            'humidity':       request_data.get('humidity'),
            'uvIndex':        request_data.get('uvIndex'),
            'cloudCover':     request_data.get('cloudCover'),
            'visibility':     request_data.get('visibility'),
            'waveHeight':     request_data.get('waveHeight'),
            'waterTemp':      request_data.get('waterTemp'),
            'precipMM':       request_data.get('precipMM'),
            'pressure':       request_data.get('pressure'),
        },
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    t = threading.Thread(target=_log_prediction_async, args=(payload,), daemon=True)
    t.start()


# ── Health ─────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'kaayko-ml-service',
        'version': 'v4-gcs-realfeatures',
    })


# ── Prediction ─────────────────────────────────────────────────────────────

@app.route('/predict', methods=['GET', 'POST'])
def ml_predict():
    try:
        data = request.get_json() if request.method == 'POST' else dict(request.args)
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        logger.info(f'🚀 /predict keys: {list(data.keys())}')

        # ── V3 structured format: { current: {...}, location: {...} } ──────
        if 'current' in data and 'location' in data:
            logger.info('✅ V3 format')
            result = predict_paddle_rating(data)
            log_prediction(data.get('current', {}), result, 'v3-structured')

        # ── Legacy flat format ─────────────────────────────────────────────
        else:
            logger.info('🔄 Legacy format')

            temperature  = float(data.get('temperature', 20))
            windSpeed    = float(data.get('windSpeed', 5))
            hasWarnings  = str(data.get('hasWarnings', 'false')).lower() == 'true'
            beaufort_raw = data.get('beaufortScale')
            beaufortScale = (
                min(int(windSpeed // 3), 12)
                if beaufort_raw in (None, 'null', '')
                else int(beaufort_raw)
            )
            uvIndex       = float(data.get('uvIndex', 5))
            visibility    = float(data.get('visibility', 10))
            humidity      = float(data.get('humidity', 50))
            cloudCover    = float(data.get('cloudCover', 50))
            latitude      = float(data.get('latitude', 30.0))
            longitude     = float(data.get('longitude', -97.0))
            location_id   = str(data.get('location_id', data.get('spotId', 'api_call')))

            # Real values — use them when present, pass None otherwise so
            # predict_konditions.py applies its own realistic estimates
            def _opt_float(key):
                v = data.get(key)
                return float(v) if v not in (None, '', 'null') else None

            result = predict_paddle_rating(
                temperature, windSpeed, hasWarnings, beaufortScale,
                uvIndex, visibility, None, humidity, cloudCover,
                latitude, longitude, location_id,
                gustSpeed=_opt_float('gustSpeed'),
                windDirection=data.get('windDirection') or None,
                waveHeight=_opt_float('waveHeight'),
                waterTemp=_opt_float('waterTemp'),
                precipMM=_opt_float('precipMM'),
                pressure=_opt_float('pressure'),
                feelsLike=_opt_float('feelsLike'),
                precipChance=_opt_float('precipChance'),
            )
            log_prediction(data, result, 'legacy-flat')

        logger.info(f'✅ result: {result}')
        return jsonify(result)

    except Exception as e:
        logger.error(f'❌ /predict error: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'rating': 2.5,
            'predictionSource': 'error-fallback',
        }), 500


# ── Model info ─────────────────────────────────────────────────────────────

@app.route('/model/info', methods=['GET'])
def model_info():
    try:
        from predict_konditions import load_production_model, LOCAL_MODEL, GCS_BUCKET, GCS_OBJECT
        model_data = load_production_model()
        model = model_data['model']
        feature_names = model_data.get('feature_names')

        local_size_mb = (
            os.path.getsize(LOCAL_MODEL) / (1024 * 1024)
            if os.path.exists(LOCAL_MODEL) else 0
        )

        return jsonify({
            'success': True,
            'model_info': {
                'algorithm':    str(type(model).__name__),
                'format':       model_data.get('format', 'unknown'),
                'features':     len(feature_names) if feature_names is not None else 'unknown',
                'local_size_mb': round(local_size_mb, 1),
                'gcs_source':   f'gs://{GCS_BUCKET}/{GCS_OBJECT}',
            },
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
