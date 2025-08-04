FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py .
COPY predict_konditions.py .

# Copy pre-trained model (no need to train in container)
COPY kaayko_production_model.pkl .

# Run with Gunicorn for production
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "2", "--timeout", "60", "main:app"]
