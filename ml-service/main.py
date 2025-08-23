"""
Kaayko ML Prediction Service - Cloud Run
Production-ready ML API using our trained model
"""
import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging

# Import our ML prediction function
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
        'service': 'kaayko-ml-service',
        'version': '1.0.0'
    })

@app.route('/predict', methods=['GET', 'POST'])
def ml_predict():
    """ML prediction endpoint"""
    try:
        # Get parameters from request
        if request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Invalid JSON in request body'}), 400
        else:  # GET request
            data = dict(request.args)

        logger.info(f"ML Prediction request: {data}")

        # Extract parameters with defaults
        temperature = float(data.get('temperature', 70))
        windSpeed = float(data.get('windSpeed', 5))
        hasWarnings = str(data.get('hasWarnings', 'false')).lower() == 'true'
        
        # Handle beaufortScale - calculate from windSpeed if null/missing
        beaufort_raw = data.get('beaufortScale')
        if beaufort_raw is None or beaufort_raw == 'null':
            beaufortScale = min(int(windSpeed // 3), 12)  # Calculate from wind speed
        else:
            beaufortScale = int(beaufort_raw)
            
        uvIndex = float(data.get('uvIndex', 5))
        visibility = float(data.get('visibility', 10))
        humidity = float(data.get('humidity', 50))
        cloudCover = float(data.get('cloudCover', 50))
        latitude = float(data.get('latitude', 30.0))
        longitude = float(data.get('longitude', -97.0))
        location_id = data.get('location_id', 'api_call')

        # Get prediction from our trained model
        result = predict_paddle_rating(
            temperature=temperature,
            windSpeed=windSpeed, 
            hasWarnings=hasWarnings,
            beaufortScale=beaufortScale,
            uvIndex=uvIndex,
            visibility=visibility,
            humidity=humidity,
            cloudCover=cloudCover,
            latitude=latitude,
            longitude=longitude,
            location_id=location_id
        )

        logger.info(f"ML Prediction result: {result}")
        return jsonify(result)

    except Exception as e:
        logger.error(f"Error in ML prediction: {str(e)}")
        import traceback
        traceback.print_exc()

        error_response = {
            'error': str(e),
            'mlModelUsed': False,
            'predictionSource': 'error-fallback',
            'rating': 2.5,
            'confidence': 'low',
            'modelType': 'error-system'
        }

        return jsonify(error_response), 500

@app.route('/train', methods=['POST'])
def train_model():
    """Online model training endpoint"""
    try:
        logger.info("Starting online model training...")
        
        # Generate training data
        import subprocess
        import glob
        
        # Run the simple training data generator
        result = subprocess.run(['python', 'generate_simple_training_data.py'], 
                              capture_output=True, text=True, cwd='.')
        
        if result.returncode != 0:
            raise Exception(f"Training data generation failed: {result.stderr}")
        
        logger.info("Training data generated successfully")
        
        # Find the generated CSV file
        csv_files = glob.glob('kaayko_comprehensive_training_data_*.csv')
        if not csv_files:
            raise Exception("No training data CSV found after generation")
        
        latest_csv = max(csv_files, key=os.path.getctime)
        logger.info(f"Using training data: {latest_csv}")
        
        # Run model creation
        result = subprocess.run(['python', 'create_model.py'], 
                              capture_output=True, text=True, cwd='.')
        
        if result.returncode != 0:
            raise Exception(f"Model training failed: {result.stderr}")
        
        logger.info("Model training completed successfully")
        
        # Reload the global model cache to use new model
        global _model_cache, _model_error
        _model_cache = None
        _model_error = None
        
        # Test the new model
        from predict_konditions import load_production_model
        new_model = load_production_model()
        
        return jsonify({
            'success': True,
            'message': 'Model trained and deployed successfully',
            'training_data_file': latest_csv,
            'model_info': {
                'version': new_model.get('metadata', {}).get('version', 'unknown'),
                'features': len(new_model.get('feature_names', [])),
                'timestamp': new_model.get('timestamp', 'unknown')
            },
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Training failed: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/model/info', methods=['GET'])
def model_info():
    """Get current model information"""
    try:
        from predict_konditions import load_production_model
        model = load_production_model()
        
        return jsonify({
            'success': True,
            'model_info': {
                'version': model.get('metadata', {}).get('version', 'unknown'),
                'algorithm': model.get('metadata', {}).get('algorithm', 'GradientBoostingRegressor'),
                'features': len(model.get('feature_names', [])),
                'training_samples': model.get('training_metrics', {}).get('n_samples', 'unknown'),
                'accuracy': model.get('training_metrics', {}).get('r2_score', 'unknown'),
                'timestamp': model.get('timestamp', 'unknown'),
                'feature_names': model.get('feature_names', [])[:10]  # Show first 10 features
            },
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/download-model', methods=['GET'])
def download_model():
    """Download the trained model file"""
    try:
        import os
        from flask import send_file
        
        model_path = os.path.join(os.path.dirname(__file__), 'kaayko_production_model.pkl')
        
        if os.path.exists(model_path):
            return send_file(
                model_path,
                as_attachment=True,
                download_name='kaayko_production_model.pkl',
                mimetype='application/octet-stream'
            )
        else:
            return jsonify({
                'success': False,
                'error': 'Model file not found',
                'path': model_path
            }), 404
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
