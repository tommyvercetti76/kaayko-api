# Multi-stage Docker build for kaayko-ml-service
# Senior Cloud Engineer approach: compatibility layer for numpy/sklearn versions

FROM python:3.11-slim as base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies first (for better caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py .
COPY predict_konditions.py .

# Copy working model
# Copy model files
COPY kaayko_production_model_compat.pkl .

# Run model compatibility rebuild (skip if already compatible)
# RUN python3 rebuild_model_compat.py

# Set environment variables for production
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run with Gunicorn for production
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "2", "--timeout", "60", "--keep-alive", "2", "main:app"]
