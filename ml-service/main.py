"""
Kaayko ML Prediction Service - Cloud Run
V3-ONLY 290MB VotingRegressor Model - NO LEGACY CODE
"""
import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging

# Import prediction functions
from predict_konditions import predict_paddle_rating

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'kaayko-ml-service-compatibility',
        'version': 'compat-83mb-universal',
        'model': 'sklearn_Pipeline_83MB'
    })

@app.route('/predict', methods=['GET', 'POST'])
def ml_predict():
    """PURE V3 MODEL PREDICTION - MODEL DOES ALL WORK"""
    try:
        # Get request data
        if request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Invalid JSON in request body'}), 400
        else:
            data = dict(request.args)

        logger.info(f"🚀 PURE V3: Request keys: {list(data.keys())}")

        # Check format and route to V3 model
        if 'current' in data and 'location' in data:
            # V3 format - direct call
            logger.info("✅ V3 format - calling predict_paddle_rating_v3")
            result = predict_paddle_rating(data)
            
        else:
            # Legacy format - convert and use V3
            logger.info("🔄 Legacy format - converting to V3")
            
            # Simple parameter extraction
            temperature = float(data.get('temperature', 70))
            windSpeed = float(data.get('windSpeed', 5))
            hasWarnings = str(data.get('hasWarnings', 'false')).lower() == 'true'
            beaufort_raw = data.get('beaufortScale')
            beaufortScale = min(int(windSpeed // 3), 12) if beaufort_raw in [None, 'null'] else int(beaufort_raw)
            uvIndex = float(data.get('uvIndex', 5))
            visibility = float(data.get('visibility', 10))
            humidity = float(data.get('humidity', 50))
            cloudCover = float(data.get('cloudCover', 50))
            latitude = float(data.get('latitude', 30.0))
            longitude = float(data.get('longitude', -97.0))
            location_id = data.get('location_id', 'api_call')

            # Call legacy function (redirects to V3 internally)
            result = predict_paddle_rating(
                temperature, windSpeed, hasWarnings, beaufortScale,
                uvIndex, visibility, None, humidity, cloudCover,
                latitude, longitude, location_id
            )

        logger.info(f"✅ PURE V3 result: {result}")
        return jsonify(result)

    except Exception as e:
        logger.error(f"❌ V3 error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'rating': 2.5,
            'predictionSource': 'v3-error'
        }), 500

@app.route('/model/info', methods=['GET'])
def model_info():
    """Get compatibility model information"""
    try:
        from predict_konditions import load_production_model
        model_data = load_production_model()
        
        # Extract from dictionary format
        model = model_data['model']
        feature_names = model_data.get('feature_names')
        model_format = model_data.get('format', 'unknown')
        
        # Get model file size
        model_path = os.path.join(os.path.dirname(__file__), 'kaayko_production_model_compat.pkl')
        file_size_mb = os.path.getsize(model_path) / (1024 * 1024) if os.path.exists(model_path) else 0
        
        return jsonify({
            'success': True,
            'model_info': {
                'version': 'compatibility_83mb',
                'algorithm': 'sklearn_Pipeline',
                'model_type': str(type(model).__name__),
                'file_size_mb': round(file_size_mb, 1),
                'features': len(feature_names) if feature_names is not None else 'unknown',
                'description': 'Compatibility Model - 83MB sklearn Pipeline with universal format handler',
                'path': model_path,
                'format_handler': 'universal',
                'numpy_compatible': True,
                'format': model_format
            },
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
# V3-ONLY REBUILD - NO LEGACY CODE
