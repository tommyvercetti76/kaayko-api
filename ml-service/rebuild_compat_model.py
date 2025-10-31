#!/usr/bin/env python3
"""
Rebuild Compatibility Model - Fix scikit-learn version issues
"""
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import os

def create_simple_compatible_model():
    """Create a simple but compatible model for production"""
    
    print("🔧 Creating simple compatible model...")
    
    # Create simple synthetic training data that matches our feature structure
    np.random.seed(42)
    
    # Generate synthetic data that approximates paddle rating patterns
    n_samples = 1000
    
    # Core weather features
    temperature = np.random.normal(22, 10, n_samples)  # Average temp around 22°C
    windSpeed = np.random.exponential(8, n_samples)    # Wind speeds, typically low
    humidity = np.random.normal(60, 20, n_samples)     # Humidity around 60%
    cloudCover = np.random.uniform(0, 100, n_samples)  # Cloud cover 0-100%
    uvIndex = np.random.uniform(1, 11, n_samples)      # UV index 1-11
    visibility = np.random.normal(10, 3, n_samples)    # Visibility around 10km
    beaufortScale = np.clip(windSpeed // 3, 0, 12).astype(int)  # Beaufort scale from wind
    
    # Derived features
    hasWarnings = (windSpeed > 15) | (temperature < 5) | (temperature > 35)
    
    # Create realistic paddle ratings based on conditions
    # Good conditions: moderate temp, low wind, low clouds, good visibility
    base_rating = 3.0
    
    # Temperature effect
    temp_effect = np.where(
        (temperature >= 15) & (temperature <= 25), 0.5,  # Ideal temp
        np.where(
            (temperature >= 10) & (temperature <= 30), 0.0,  # OK temp
            -0.8  # Too cold or hot
        )
    )
    
    # Wind effect
    wind_effect = np.where(
        windSpeed <= 10, 0.3,  # Light wind
        np.where(
            windSpeed <= 20, -0.2,  # Moderate wind
            -1.0  # Strong wind
        )
    )
    
    # Cloud effect
    cloud_effect = np.where(
        cloudCover <= 30, 0.2,  # Clear
        np.where(
            cloudCover <= 70, 0.0,  # Partly cloudy
            -0.3  # Overcast
        )
    )
    
    # Visibility effect
    vis_effect = np.where(visibility >= 8, 0.1, -0.2)
    
    # Warning effect
    warning_effect = np.where(hasWarnings, -0.8, 0.0)
    
    # Combine effects with some noise
    paddle_rating = (base_rating + temp_effect + wind_effect + 
                    cloud_effect + vis_effect + warning_effect + 
                    np.random.normal(0, 0.2, n_samples))
    
    # Clip to valid range
    paddle_rating = np.clip(paddle_rating, 1.0, 5.0)
    
    # Create feature DataFrame
    features = pd.DataFrame({
        'temperature': temperature,
        'windSpeed': windSpeed,
        'humidity': humidity,
        'cloudCover': cloudCover,
        'uvIndex': uvIndex,
        'visibility': visibility,
        'beaufortScale': beaufortScale,
        'hasWarnings': hasWarnings.astype(int),
        # Add some additional features to match expected structure
        'temp_category': np.digitize(temperature, [10, 20, 30]),
        'wind_category': np.digitize(windSpeed, [10, 20]),
        'uv_category': np.digitize(uvIndex, [3, 6, 8]),
        'isMorning': np.random.choice([0, 1], n_samples),
        'isNoon': np.random.choice([0, 1], n_samples),
        'isEvening': np.random.choice([0, 1], n_samples),
    })
    
    print(f"✅ Generated {n_samples} training samples")
    print(f"📊 Features shape: {features.shape}")
    print(f"🎯 Rating range: {paddle_rating.min():.1f} - {paddle_rating.max():.1f}")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        features, paddle_rating, test_size=0.2, random_state=42
    )
    
    # Create a simple but effective pipeline
    pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('regressor', RandomForestRegressor(
            n_estimators=50,
            max_depth=10,
            random_state=42,
            n_jobs=1  # Single job for compatibility
        ))
    ])
    
    print("🤖 Training model...")
    pipeline.fit(X_train, y_train)
    
    # Test the model
    train_score = pipeline.score(X_train, y_train)
    test_score = pipeline.score(X_test, y_test)
    
    print(f"📈 Train R²: {train_score:.3f}")
    print(f"📉 Test R²: {test_score:.3f}")
    
    # Store feature names in the pipeline for later access
    # Note: feature_names_in_ is automatically set during fit()
    
    return pipeline

def save_compatible_model():
    """Save the compatible model"""
    
    print("🔧 Building compatible model for production...")
    
    # Create the model
    model = create_simple_compatible_model()
    
    # Save with current scikit-learn version
    output_path = 'kaayko_production_model_compat_v2.pkl'
    
    print(f"💾 Saving model to {output_path}...")
    joblib.dump(model, output_path, compress=1)
    
    # Check file size
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"📦 Model saved: {size_mb:.1f} MB")
    
    # Test loading
    print("🧪 Testing model loading...")
    loaded_model = joblib.load(output_path)
    
    # Test prediction
    test_data = pd.DataFrame([{
        'temperature': 22.0,
        'windSpeed': 8.0,
        'humidity': 60.0,
        'cloudCover': 30.0,
        'uvIndex': 6.0,
        'visibility': 10.0,
        'beaufortScale': 2,
        'hasWarnings': 0,
        'temp_category': 1,
        'wind_category': 0,
        'uv_category': 1,
        'isMorning': 0,
        'isNoon': 1,
        'isEvening': 0,
    }])
    
    prediction = loaded_model.predict(test_data)[0]
    print(f"🎯 Test prediction: {prediction:.2f}")
    
    print("✅ Compatible model created successfully!")
    return output_path

if __name__ == "__main__":
    save_compatible_model()