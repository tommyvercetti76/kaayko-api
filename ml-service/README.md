# Kaayko ML Production Service

Minimal production deployment for Kaayko paddle condition prediction API.

## Files
- `main.py` - Flask API service
- `predict_konditions.py` - Model loading and prediction logic
- `kaayko_production_model.pkl` - Trained production model
- `Dockerfile` - Production container
- `requirements.txt` - Minimal production dependencies

## API Endpoints
- `GET /health` - Health check
- `POST /predict` - Paddle condition predictions
- `GET /model/info` - Model information

## Deployment
```bash
docker build -t kaayko-ml-service .
docker run -p 8080:8080 kaayko-ml-service
```

## Model Info
- **Algorithm**: RandomForest/XGBoost
- **Features**: 23 weather and location features
- **Performance**: R² > 0.999, MAE < 0.001
- **Training Data**: 2.36M records from 190 lakes

## Security
- Rate limiting: 20 requests/60 seconds (via Firebase Functions)
- No API keys required (internal service)
- Health checks enabled
