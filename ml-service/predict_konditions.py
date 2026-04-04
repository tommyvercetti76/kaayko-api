#!/usr/bin/env python3
"""
========================================================================
PRODUCTION ML PREDICTION MODULE: Trained Model + Rule-based Fallback
========================================================================

PURPOSE:
This is the UPGRADED ML prediction system that uses your trained production
model (99.56% accuracy) with rule-based fallback for reliability.

WHAT IT DOES:
- Loads the trained kaayko_production_model.pkl (primary prediction)
- Uses 31 engineered features for maximum accuracy
- Falls back to rule-based system if model fails
- Returns consistent 0.0-5.0 paddle safety ratings

HOW IT WORKS:
1. Attempts to load and use production ML model first
2. Extracts proper features using trained encoders
3. Makes prediction using GradientBoosting model
4. Falls back to rule-based system if anything fails
5. Returns rating with confidence metadata

TRAINED ON:
- 12,000 samples from 17 real Kaayko locations
- Real weather data + smart synthetic variations  
- Texas lakes, Colorado reservoirs, international locations
- GradientBoosting model with 99.56% training accuracy

Author: Kaayko ML Team
Version: Production 2.0 (Trained Model)
========================================================================
"""

import joblib
import sys
import os
import numpy as np
from datetime import datetime
import traceback

# Global model cache
_model_cache = None
_model_error = None

# GCS bucket / object path (override with env vars at deploy time)
GCS_BUCKET  = os.environ.get('ML_MODEL_BUCKET', 'kaayko-ml-models')
GCS_OBJECT  = os.environ.get('ML_MODEL_OBJECT', 'paddle-score/current.pkl')
LOCAL_MODEL = 'kaayko_production_model_compat.pkl'


def _download_model_from_gcs(dest_path: str) -> bool:
    """Download model from GCS to dest_path. Returns True on success."""
    try:
        from google.cloud import storage  # type: ignore
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob   = bucket.blob(GCS_OBJECT)
        blob.download_to_filename(dest_path)
        size_mb = os.path.getsize(dest_path) / (1024 * 1024)
        print(f'☁️  Downloaded model from gs://{GCS_BUCKET}/{GCS_OBJECT} → {dest_path} ({size_mb:.1f} MB)')
        return True
    except Exception as e:
        print(f'⚠️  GCS download failed ({e}), will use local model if present')
        return False


def load_production_model():
    """Load the production ML model — GCS first, then local fallback."""
    global _model_cache, _model_error

    if _model_cache is not None:
        return _model_cache

    # Always try to load on new container - don't cache errors across container restarts
    # if _model_error is not None:
    #     raise Exception(f"Model previously failed to load: {_model_error}")

    try:
        # Try to download from GCS first so the running container always uses the
        # latest model without requiring a Docker rebuild / redeploy.
        gcs_dest = '/tmp/model_gcs.pkl'
        if _download_model_from_gcs(gcs_dest):
            model_path = gcs_dest
        else:
            model_path = LOCAL_MODEL

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Production model not found at {model_path}")
        
        print(f"🚀 Loading production model from {model_path}")
        model_data = joblib.load(model_path)
        
        # UNIVERSAL MODEL FORMAT HANDLER - Handle ALL possible formats
        print(f"🔍 Model format detection: {type(model_data)}")
        
        # FORMAT 1: Pipeline format (sklearn Pipeline object)
        if hasattr(model_data, 'predict') and hasattr(model_data, 'steps'):
            print("📦 Format: sklearn Pipeline detected")
            pipeline_model = model_data
            
            # Extract feature names if available
            feature_names = None
            if hasattr(pipeline_model, 'feature_names_in_'):
                feature_names = pipeline_model.feature_names_in_
            elif hasattr(pipeline_model, '_feature_names_in'):
                feature_names = pipeline_model._feature_names_in
            
            _model_cache = {
                'model': pipeline_model,
                'scaler': None,  # Pipeline handles scaling internally
                'label_encoders': {},  # Pipeline handles encoding internally  
                'feature_names': feature_names,
                'timestamp': 'pipeline-format',
                'format': 'pipeline'
            }
            
            print(f"✅ Pipeline model loaded successfully!")
            print(f"📊 Model type: {type(pipeline_model).__name__}")
            print(f"🎯 Features: {len(feature_names) if feature_names is not None else 'unknown'}")
            
            return _model_cache
        
        # FORMAT 2: Direct model object (any sklearn estimator)
        elif hasattr(model_data, 'predict') and not hasattr(model_data, 'steps'):
            print("🤖 Format: Direct sklearn estimator detected")
            
            feature_names = None
            if hasattr(model_data, 'feature_names_in_'):
                feature_names = model_data.feature_names_in_
            
            _model_cache = {
                'model': model_data,
                'scaler': None,
                'label_encoders': {},
                'feature_names': feature_names,
                'timestamp': 'direct-estimator',
                'format': 'estimator'
            }
            
            print(f"✅ Direct estimator loaded successfully!")
            print(f"📊 Model type: {type(model_data).__name__}")
            
            return _model_cache
        
        # FORMAT 3: Dictionary format (structured training output)
        elif isinstance(model_data, dict):
            print("📁 Format: Dictionary structure detected")
            
            # Check for required keys
            required_keys = ['model', 'scaler', 'label_encoders', 'feature_names']
            has_all_keys = all(key in model_data for key in required_keys)
            
            if has_all_keys:
                print("✅ Complete dictionary format with all components")
                _model_cache = model_data
                _model_cache['format'] = 'dict-complete'
            else:
                print("⚠️ Partial dictionary format - filling missing components")
                
                # Extract the model object
                model_obj = None
                if 'model' in model_data:
                    model_obj = model_data['model']
                elif 'estimator' in model_data:
                    model_obj = model_data['estimator']
                elif 'pipeline' in model_data:
                    model_obj = model_data['pipeline']
                else:
                    # Try to find any object with predict method
                    for key, value in model_data.items():
                        if hasattr(value, 'predict'):
                            model_obj = value
                            break
                
                if model_obj is None:
                    raise ValueError("No predictive model found in dictionary")
                
                _model_cache = {
                    'model': model_obj,
                    'scaler': model_data.get('scaler', None),
                    'label_encoders': model_data.get('label_encoders', {}),
                    'feature_names': model_data.get('feature_names', None),
                    'timestamp': model_data.get('timestamp', 'dict-partial'),
                    'format': 'dict-partial'
                }
            
            print(f"✅ Dictionary model loaded successfully!")
            print(f"📊 Model type: {type(_model_cache['model']).__name__}")
            print(f"🎯 Features: {len(_model_cache['feature_names']) if _model_cache['feature_names'] else 'unknown'}")
            
            return _model_cache
        
        # FORMAT 4: Unknown format - try to make it work anyway
        else:
            print("❓ Format: Unknown - attempting generic handling")
            
            # If it has a predict method, treat it as a model
            if hasattr(model_data, 'predict'):
                _model_cache = {
                    'model': model_data,
                    'scaler': None,
                    'label_encoders': {},
                    'feature_names': None,
                    'timestamp': 'unknown-format',
                    'format': 'unknown'
                }
                
                print(f"✅ Unknown format model loaded (has predict method)!")
                print(f"📊 Model type: {type(model_data).__name__}")
                
                return _model_cache
            else:
                raise ValueError(f"Unsupported model format: {type(model_data)}. No predict method found.")
        
    except Exception as e:
        _model_error = str(e)
        print(f"❌ Failed to load production model: {e}")
        raise e

def extract_production_features(temperature, windSpeed, hasWarnings, beaufortScale,
                              uvIndex, visibility, humidity=50, cloudCover=50,
                              latitude=30.0, longitude=-97.0, location_id="default",
                              gustSpeed=None, windDirection=None, waveHeight=None,
                              waterTemp=None, precipMM=None, pressure=None,
                              feelsLike=None, precipChance=None):
    """Extract features in the same format as the new training data.

    Real values are used when provided; sensible estimates fill any gaps so the
    function remains backward-compatible while making full use of available data.
    """

    # ── Resolve optional fields with realistic estimates ────────────────────
    gustSpeed     = float(gustSpeed)     if gustSpeed     is not None else float(windSpeed * 1.3)
    pressure      = float(pressure)      if pressure      is not None else 1013.0
    feelsLike     = float(feelsLike)     if feelsLike     is not None else float(temperature)
    precipMM      = float(precipMM)      if precipMM      is not None else 0.0
    precipChance  = float(precipChance)  if precipChance  is not None else min(100.0, float(cloudCover) * 0.8)

    # Wind direction: convert compass string → degrees if needed
    _COMPASS = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5,
    }
    if windDirection is None:
        windDegree = 180.0
        windDirStr = 'S'
    elif isinstance(windDirection, str):
        windDegree = float(_COMPASS.get(windDirection.upper(), 180.0))
        windDirStr = windDirection.upper()
    else:
        windDegree = float(windDirection)
        # reverse-map degrees to the nearest compass label
        closest = min(_COMPASS, key=lambda k: abs(_COMPASS[k] - windDegree))
        windDirStr = closest

    # Get current time info
    now = datetime.now()
    hour = now.hour
    day_index = 0  # Current day (0=today)
    date_str = now.strftime("%Y-%m-%d")

    # Determine time slot based on hour
    if 7 <= hour <= 9:
        time_slot = "MORNING"
    elif 12 <= hour <= 14:
        time_slot = "NOON"
    elif 17 <= hour <= 19:
        time_slot = "EVENING"
    else:
        if hour < 12:
            time_slot = "MORNING"
        elif hour < 17:
            time_slot = "NOON"
        else:
            time_slot = "EVENING"

    # Base numerical features from new training format
    numerical_features = {
        'latitude':     float(latitude),
        'longitude':    float(longitude),
        'hour':         hour,
        'day_index':    day_index,
        'distance_km':  0.0,
        'temperature':  float(temperature),
        'feelsLike':    feelsLike,
        'windSpeed':    float(windSpeed),
        'gustSpeed':    gustSpeed,
        'windDegree':   windDegree,
        'humidity':     float(humidity),
        'uvIndex':      float(uvIndex),
        'visibility':   float(visibility),
        'cloudCover':   float(cloudCover),
        'pressure':     pressure,
        'precipChance': precipChance,
        'precipMM':     precipMM,
    }

    # Wave height feeds the model when available (ocean/large-lake locations)
    if waveHeight is not None:
        numerical_features['waveHeight'] = float(waveHeight)

    # Water temperature — real value is far more accurate than an air-temp proxy
    if waterTemp is not None:
        numerical_features['waterTemp'] = float(waterTemp)
    
    # Add derived time features (calculated like in training)
    import pandas as pd
    date_obj = pd.to_datetime(date_str)
    numerical_features['is_weekend'] = 1 if date_obj.dayofweek >= 5 else 0
    numerical_features['month'] = date_obj.month
    numerical_features['day_of_week'] = date_obj.dayofweek
    numerical_features['day_of_year'] = date_obj.dayofyear
    
    # Time-based binary features
    numerical_features['isMorning'] = 1 if time_slot == 'MORNING' else 0
    numerical_features['isNoon'] = 1 if time_slot == 'NOON' else 0  
    numerical_features['isEvening'] = 1 if time_slot == 'EVENING' else 0
    
    # Weather categorization (as integers like in training)
    if temperature <= 10:
        numerical_features['temp_category'] = 0
    elif temperature <= 20:
        numerical_features['temp_category'] = 1
    elif temperature <= 30:
        numerical_features['temp_category'] = 2
    else:
        numerical_features['temp_category'] = 3
    
    if windSpeed <= 10:
        numerical_features['wind_category'] = 0
    elif windSpeed <= 20:
        numerical_features['wind_category'] = 1
    else:
        numerical_features['wind_category'] = 2
    
    if uvIndex <= 3:
        numerical_features['uv_category'] = 0
    elif uvIndex <= 6:
        numerical_features['uv_category'] = 1
    elif uvIndex <= 8:
        numerical_features['uv_category'] = 2
    else:
        numerical_features['uv_category'] = 3
    
    # Categorical features that need encoding
    categorical_features = {
        'location_id': str(location_id),
        'base_location': 'API_PREDICTION',  # Identifier for API calls
        'time_slot': time_slot,
        'windDirection': 'S',  # Default south
        'condition': 'Clear'   # Default condition
    }
    
    return numerical_features, categorical_features

def predict_with_production_model(temperature, windSpeed, hasWarnings, beaufortScale,
                                uvIndex, visibility, humidity=50, cloudCover=50,
                                latitude=30.0, longitude=-97.0, location_id="api_call",
                                gustSpeed=None, windDirection=None, waveHeight=None,
                                waterTemp=None, precipMM=None, pressure=None,
                                feelsLike=None, precipChance=None):
    """Make prediction using the trained production model"""

    try:
        # Load model
        model_data = load_production_model()
        model = model_data['model']
        scaler = model_data['scaler']
        label_encoders = model_data['label_encoders']
        feature_names = model_data['feature_names']

        # Extract features — pass all real values through
        numerical_features, categorical_features = extract_production_features(
            temperature, windSpeed, hasWarnings, beaufortScale,
            uvIndex, visibility, humidity, cloudCover,
            latitude, longitude, location_id,
            gustSpeed=gustSpeed, windDirection=windDirection,
            waveHeight=waveHeight, waterTemp=waterTemp,
            precipMM=precipMM, pressure=pressure,
            feelsLike=feelsLike, precipChance=precipChance,
        )
        
        import pandas as pd
        
        # Create numerical DataFrame
        X_numerical = pd.DataFrame([numerical_features])
        
        # Create categorical DataFrame with encoding
        X_categorical = pd.DataFrame()
        
        for feature_name, feature_value in categorical_features.items():
            if feature_name in label_encoders:
                encoder = label_encoders[feature_name]
                feature_value_str = str(feature_value)
                
                # Handle unseen categories
                if feature_value_str in encoder.classes_:
                    encoded_value = encoder.transform([feature_value_str])[0]
                else:
                    # Use the first class for unseen categories
                    encoded_value = 0
                    print(f"⚠️  Unseen category '{feature_value_str}' for {feature_name}, using default")
                
                X_categorical[f'{feature_name}_encoded'] = [encoded_value]
        
        # Combine features
        X_combined = pd.concat([X_numerical, X_categorical], axis=1)
        
        # Reorder columns to match training feature order
        X_final = X_combined.reindex(columns=feature_names, fill_value=0)
        
        # Validate feature count
        if X_final.shape[1] != len(feature_names):
            raise ValueError(f"Feature count mismatch: got {X_final.shape[1]}, expected {len(feature_names)}")
        
        # Scale features (handle None scaler for identity scaling)
        if scaler is not None:
            X_scaled = scaler.transform(X_final)
        else:
            X_scaled = X_final.values  # Use raw values when no scaling needed
        
        # Make prediction
        prediction = model.predict(X_scaled)[0]
        
        # Ensure prediction is in valid range
        prediction = max(1.0, min(5.0, prediction))
        
        # Round to nearest 0.5 for UI consistency (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0)
        prediction = round(prediction * 2) / 2
        
        print(f"🎯 Production ML prediction: {prediction:.1f}")
        
        return {
            'success': True,
            'rating': prediction,
            'source': 'production-ml-model',
            'model_type': type(model).__name__,
            'confidence': 'high',
            'features_used': len(feature_names)
        }
        
    except Exception as e:
        print(f"❌ Production model prediction failed: {e}")
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'fallback_needed': True
        }

def predict_paddle_rating(temperature, windSpeed, hasWarnings, beaufortScale,
                         uvIndex, visibility, model_path=None, humidity=50, cloudCover=50,
                         latitude=30.0, longitude=-97.0, location_id="api_call",
                         gustSpeed=None, windDirection=None, waveHeight=None,
                         waterTemp=None, precipMM=None, pressure=None,
                         feelsLike=None, precipChance=None):
    """
    =======================================================================
    MAIN PREDICTION FUNCTION: Production ML Model + Rule-based Fallback
    =======================================================================

    This function first attempts to use the trained production ML model
    and falls back to rule-based predictions if needed.

    Returns:
    --------
    dict with rating, mlModelUsed, predictionSource
    """

    return_detailed = True

    try:
        print(f"🚀 Attempting production ML prediction...")
        ml_result = predict_with_production_model(
            temperature, windSpeed, hasWarnings, beaufortScale,
            uvIndex, visibility, humidity, cloudCover,
            latitude, longitude, location_id,
            gustSpeed=gustSpeed, windDirection=windDirection,
            waveHeight=waveHeight, waterTemp=waterTemp,
            precipMM=precipMM, pressure=pressure,
            feelsLike=feelsLike, precipChance=precipChance,
        )
        
        if ml_result['success']:
            print(f"✅ Using production ML model result: {ml_result['rating']}")
            
            if return_detailed:
                return {
                    'rating': ml_result['rating'],
                    'mlModelUsed': True,
                    'predictionSource': 'ml-model',
                    'modelType': ml_result.get('model_type', 'RandomForestRegressor'),
                    'confidence': 'high',
                    'featuresUsed': ml_result.get('features_used', 31)
                }
            return ml_result['rating']
        else:
            print(f"⚠️  Production ML failed, falling back to rule-based...")
    
    except Exception as e:
        print(f"❌ Production ML error: {e}")
        print(f"⚠️  Falling back to rule-based prediction...")
    
    # Fallback to rule-based prediction
    fallback_rating = predict_paddle_rating_rules(
        temperature, windSpeed, hasWarnings, beaufortScale,
        uvIndex, visibility, humidity, cloudCover
    )
    
    if return_detailed:
        return {
            'rating': fallback_rating,
            'mlModelUsed': False,
            'predictionSource': 'rule-based-fallback',
            'modelType': 'rule-based-system',
            'confidence': 'medium',
            'featuresUsed': 8
        }
    
    return fallback_rating

def predict_paddle_rating_rules(temperature, windSpeed, hasWarnings, beaufortScale, 
                               uvIndex, visibility, humidity=50, cloudCover=50):
    """
    Rule-based prediction (original logic as fallback)
    """
    try:
        # Calculate heat index (simplified - using temperature as approximation)
        heat_index = temperature
        
        # Evaluate 4 core conditions (all must be favorable for 5.0)
        core_conditions = [
            is_heat_index_favorable(heat_index),
            is_cloud_cover_favorable(cloudCover),
            is_wind_favorable(beaufortScale),
            is_uv_favorable(uvIndex)
        ]
        
        # Evaluate 4 supplementary conditions (need at least 2 for 5.0)
        supplementary_conditions = [
            is_visibility_favorable(visibility),
            is_humidity_favorable(humidity),
            is_water_temperature_favorable(temperature),  # Using air temp as approximation
            is_buoyancy_favorable(temperature, windSpeed)
        ]
        
        # Count favorable conditions
        favorable_core = sum(core_conditions)
        favorable_supplementary = sum(supplementary_conditions)
        
        # Base score calculation
        # Core conditions: 0.75 points each (max 3.0)
        # Supplementary: 0.5 points each (max 2.0)
        base_score = (favorable_core * 0.75) + (favorable_supplementary * 0.5)
        
        # Apply penalties
        warning_penalty = 1.0 if hasWarnings else 0.0
        final_score = base_score - warning_penalty
        
        # Ensure score is within bounds
        final_score = max(0.0, min(5.0, final_score))
        
        # Round to nearest 0.5
        final_score = round(final_score * 2) / 2
        
        print(f"🔧 Rule-based prediction: {final_score}")
        return final_score
        
    except Exception as e:
        print(f"❌ Rule-based prediction failed: {e}")
        return 2.5  # Neutral fallback

# Helper functions for rule-based system
def is_heat_index_favorable(heat_index):
    return 15 <= heat_index <= 32

def is_cloud_cover_favorable(cloud_cover):
    return 10 <= cloud_cover <= 70

def is_wind_favorable(beaufort_scale):
    return beaufort_scale <= 3

def is_uv_favorable(uv_index):
    return uv_index <= 7

def is_visibility_favorable(visibility):
    return visibility >= 5

def is_humidity_favorable(humidity):
    return 30 <= humidity <= 80

def is_water_temperature_favorable(temperature):
    return temperature >= 12

def is_buoyancy_favorable(temperature, wind_speed):
    return temperature >= 15 and wind_speed <= 15

# Export the main function
if __name__ == "__main__":
    # Test with sample data
    rating = predict_paddle_rating(
        temperature=22,
        windSpeed=10,
        hasWarnings=0,
        beaufortScale=2,
        uvIndex=4,
        visibility=15
    )
    print(f"Test prediction: {rating}")
