FROM python:3.11-slim
RUN pip install --upgrade pip setuptools wheel
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

COPY migrations/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ml_platform_core/ /app/ml_platform_core/
RUN pip install --no-cache-dir /app/ml_platform_core/

COPY migrations/alembic.ini /app/alembic.ini
COPY migrations/env.py /app/env.py
COPY migrations/script.py.mako /app/script.py.mako
COPY migrations/versions/ /app/versions/

RUN chown -R appuser:appuser /app
USER appuser

CMD ["alembic", "upgrade", "head"]
