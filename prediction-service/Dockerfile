FROM python:3.11-slim
RUN pip install --upgrade pip setuptools wheel
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

COPY prediction-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ml_platform_core/ /app/ml_platform_core/
RUN pip install --no-cache-dir /app/ml_platform_core/

COPY prediction-service/app/ /app/app/

RUN mkdir -p /app/storage \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
