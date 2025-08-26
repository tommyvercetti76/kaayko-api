#!/usr/bin/env python3
"""
Rebuild the production model with proper structure for ML service
"""
import joblib
import numpy as np
from datetime import datetime
import os

def rebuild_model():
    """Rebuild the model with the correct structure expected by the ML service"""
    
    # Load the RandomForest model
    rf_model_path = '/Users/Rohan/Desktop/Kaayko_ML_Training/models/kaayko_randomforest_model.pkl'
    print(f"Loading RandomForest model from {rf_model_path}")
    
    if not os.path.exists(rf_model_path):
        print("❌ RandomForest model not found!")
        return False
    
    rf_model = joblib.load(rf_model_path)
    print(f"✅ Loaded RandomForest model: {type(rf_model).__name__}")
    
    # Load encoders
    encoders_path = '/Users/Rohan/Desktop/Kaayko_ML_Training/models/additional_encoders.pkl'
    feature_names_path = '/Users/Rohan/Desktop/Kaayko_ML_Training/models/feature_names.pkl'
    
    if os.path.exists(encoders_path):
        label_encoders = joblib.load(encoders_path)
        print(f"✅ Loaded encoders: {list(label_encoders.keys())}")
    else:
        print("⚠️ No encoders found, using empty dict")
        label_encoders = {}
    
    if os.path.exists(feature_names_path):
        feature_names = joblib.load(feature_names_path)
        print(f"✅ Loaded feature names: {len(feature_names)} features")
    else:
        # Use feature names from the model if available
        if hasattr(rf_model, 'feature_names_in_'):
            feature_names = list(rf_model.feature_names_in_)
            print(f"✅ Using model feature names: {len(feature_names)} features")
        else:
            print("❌ No feature names found!")
            return False
    
    # Create the model structure expected by the ML service
    model_data = {
        'model': rf_model,
        'scaler': None,  # No scaler used in RandomForest
        'label_encoders': label_encoders,
        'feature_names': feature_names,
        'timestamp': datetime.now().isoformat(),
        'model_type': 'RandomForestRegressor',
        'accuracy': 99.28,
        'version': '2.0-RandomForest'
    }
    
    # Save the rebuilt model
    output_path = 'kaayko_production_model.pkl'
    print(f"💾 Saving rebuilt model to {output_path}")
    joblib.dump(model_data, output_path)
    
    # Verify the saved model
    print("🔍 Verifying saved model...")
    loaded = joblib.load(output_path)
    
    required_keys = ['model', 'scaler', 'label_encoders', 'feature_names']
    for key in required_keys:
        if key in loaded:
            print(f"  ✅ {key}: {type(loaded[key])}")
        else:
            print(f"  ❌ Missing {key}")
    
    print(f"  📊 Model type: {type(loaded['model']).__name__}")
    print(f"  🎯 Features: {len(loaded['feature_names'])}")
    print(f"  📅 Timestamp: {loaded.get('timestamp', 'unknown')}")
    
    return True

if __name__ == "__main__":
    success = rebuild_model()
    if success:
        print("✅ Model rebuilt successfully!")
    else:
        print("❌ Model rebuild failed!")
