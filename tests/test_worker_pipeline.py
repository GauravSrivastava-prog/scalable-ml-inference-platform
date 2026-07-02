"""
Integration test: Celery Worker Pipeline (Phase 4 — Autonomous Testing)

Tests the full round-trip:
  1. Register a test user → get JWT
  2. Upload sample_dataset.csv → get dataset_id
  3. Dispatch a training task → poll for state transitions (PREPROCESSING → FITTING → ready)
  4. Once ready, dispatch a batch prediction → assert success

Usage:
    # From project root (cluster must be running):
    python -m pytest tests/test_worker_pipeline.py -v --tb=short

    # Or run directly for quick smoke-test:
    python tests/test_worker_pipeline.py

Environment:
    API_BASE_URL  — default: http://localhost:9000
    POLL_TIMEOUT  — seconds to wait for training to complete (default: 300)
    POLL_INTERVAL — seconds between status polls (default: 3)
"""

import os
import sys
import time
import uuid
import json
import requests
import pytest

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
API_BASE     = os.environ.get("API_BASE_URL", "http://localhost:9000").rstrip("/")
POLL_TIMEOUT = int(os.environ.get("POLL_TIMEOUT", "300"))    # 5 minutes max
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "3"))    # check every 3s

# Nginx routes all traffic under /api/v1/
AUTH_BASE  = f"{API_BASE}/api/v1/auth"
MODEL_BASE = f"{API_BASE}/api/v1/models"
PRED_BASE  = f"{API_BASE}/api/v1/predictions"

# Use a stable test user so re-runs don't fail on unique-email constraint
TEST_EMAIL    = f"celery-test@mlplatform.internal"
TEST_PASSWORD = "CeleryTest2026!"
TEST_USERNAME = "celery_test_bot"

DATASET_PATH  = os.path.join(os.path.dirname(__file__), "..", "sample_dataset.csv")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _register_or_login() -> str:
    """Register a new test user, or login if already exists. Returns JWT token."""
    # Try login first (idempotent across test runs)
    r = requests.post(f"{AUTH_BASE}/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
    }, timeout=10)
    if r.status_code == 200:
        token = r.json().get("access_token")
        print(f"  [AUTH] Logged in as {TEST_EMAIL}")
        return token

    # Register fresh
    r = requests.post(f"{AUTH_BASE}/register", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "username": TEST_USERNAME,
    }, timeout=10)
    assert r.status_code in (200, 201), f"Registration failed: {r.status_code} {r.text}"
    print(f"  [AUTH] Registered {TEST_EMAIL}")

    r = requests.post(f"{AUTH_BASE}/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
    }, timeout=10)
    assert r.status_code == 200, f"Login after register failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _upload_dataset(token: str) -> tuple[str, list[str]]:
    """Upload sample_dataset.csv. Returns (dataset_id, columns)."""
    assert os.path.isfile(DATASET_PATH), (
        f"sample_dataset.csv not found at {DATASET_PATH}. "
        "Ensure you're running from the project root."
    )
    with open(DATASET_PATH, "rb") as f:
        r = requests.post(
            f"{MODEL_BASE}/upload-dataset",
            headers=_auth_headers(token),
            files={"file": ("sample_dataset.csv", f, "text/csv")},
            timeout=30,
        )
    assert r.status_code == 201, f"Dataset upload failed: {r.status_code} {r.text}"
    body = r.json()
    print(f"  [UPLOAD] dataset_id={body['dataset_id']} rows={body['rows']} cols={body['columns']}")
    return body["dataset_id"], body["columns"]


def _poll_model_status(token: str, model_id: str) -> dict:
    """
    Poll GET /models/{model_id} until status is terminal (ready or failed),
    printing each observed state transition.
    Returns the final model record dict.
    """
    last_status = None
    last_detail = None
    deadline = time.time() + POLL_TIMEOUT

    print(f"\n  [POLL] Waiting up to {POLL_TIMEOUT}s for model {model_id[:8]}… to reach terminal state")

    while time.time() < deadline:
        r = requests.get(
            f"{MODEL_BASE}/{model_id}",
            headers=_auth_headers(token),
            timeout=10,
        )
        if r.status_code != 200:
            print(f"    ⚠  GET /models/{model_id[:8]}… returned {r.status_code} — retrying")
            time.sleep(POLL_INTERVAL)
            continue

        body = r.json()
        status = body.get("status")
        detail = body.get("status_detail")

        # Print only on state change to avoid log spam
        if status != last_status or detail != last_detail:
            ts = time.strftime("%H:%M:%S")
            print(f"    [{ts}] status={status!r} detail={detail!r}")
            last_status = status
            last_detail = detail

        if status in ("ready", "failed"):
            return body

        time.sleep(POLL_INTERVAL)

    raise TimeoutError(
        f"Model {model_id[:8]}… did not reach terminal state within {POLL_TIMEOUT}s. "
        f"Last status: {last_status!r} detail={last_detail!r}"
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTrainingWorkerPipeline:
    """Full integration test: training queue → state telemetry → inference."""

    @pytest.fixture(scope="class")
    def token(self):
        return _register_or_login()

    @pytest.fixture(scope="class")
    def dataset(self, token):
        return _upload_dataset(token)

    def test_01_cluster_health(self):
        """Verify the prediction-service health endpoint is reachable."""
        r = requests.get(f"{PRED_BASE}/health", timeout=5)
        assert r.status_code == 200, f"Cluster unhealthy: {r.status_code} {r.text}"
        assert r.json()["status"] == "healthy"
        print("\n  [HEALTH] Cluster is healthy ✓")

    def test_02_dispatch_training_task(self, token, dataset):
        """POST /models/train → 201 with status='training'."""
        dataset_id, columns = dataset
        # Use the first non-obvious column as target (skip index cols)
        target = [c for c in columns if c.lower() not in ("unnamed: 0", "id", "index")][0]

        r = requests.post(
            f"{MODEL_BASE}/train",
            headers=_auth_headers(token),
            json={
                "name": f"celery-test-{uuid.uuid4().hex[:6]}",
                "dataset_id": dataset_id,
                "target_column": target,
                "algorithm": "random_forest",
                "training_params": {"n_estimators": 10, "max_depth": 5},
            },
            timeout=15,
        )
        assert r.status_code == 201, f"Train dispatch failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "training", f"Unexpected initial status: {body['status']!r}"
        assert "model_id" in body

        # Store on class for subsequent tests
        TestTrainingWorkerPipeline._model_id = body["model_id"]
        TestTrainingWorkerPipeline._target    = target
        TestTrainingWorkerPipeline._columns   = columns
        print(f"\n  [DISPATCH] model_id={body['model_id'][:8]}… target={target!r} → queued on ml_training ✓")

    def test_03_state_transitions_and_ready(self, token):
        """Poll until model reaches 'ready'. Verifies granular telemetry checkpoints."""
        model_id = TestTrainingWorkerPipeline._model_id
        final = _poll_model_status(token, model_id)

        assert final["status"] == "ready", (
            f"Model did not reach 'ready'. Final state: {final['status']!r} "
            f"detail={final.get('status_detail')!r}\n"
            f"Full response: {json.dumps(final, indent=2)}"
        )
        assert final.get("metrics") is not None, "Model is ready but metrics are None"
        assert "celery_task_id" in final, "celery_task_id missing from model record"
        print(f"\n  [READY] Model is ready ✓ metrics keys: {list(final['metrics'].keys())}")

    def test_04_batch_prediction(self, token):
        """POST /predictions/batch with a valid input row → HTTP 202, successful_predictions > 0."""
        model_id = TestTrainingWorkerPipeline._model_id

        # Fetch model to get feature_columns from metrics
        r = requests.get(
            f"{MODEL_BASE}/{model_id}",
            headers=_auth_headers(token),
            timeout=10,
        )
        assert r.status_code == 200
        model_body = r.json()
        feature_cols = model_body["metrics"].get("feature_columns", [])
        sample_data  = model_body["metrics"].get("sample_data", [])

        assert feature_cols, "No feature_columns in model metrics — cannot build batch payload"
        assert sample_data,  "No sample_data in model metrics — cannot build batch payload"

        # Use the first sample row as our test input
        batch_input = [sample_data[0]]

        r = requests.post(
            f"{PRED_BASE}/batch",
            headers=_auth_headers(token),
            json={
                "model_id": model_id,
                "input_data": batch_input,
            },
            timeout=30,
        )
        assert r.status_code == 202, f"Batch prediction failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["successful_predictions"] > 0, (
            f"Batch prediction returned 0 successes: {json.dumps(body, indent=2)}"
        )
        print(
            f"\n  [BATCH PREDICT] successful={body['successful_predictions']} "
            f"failed={body['failed_predictions']} latency={body['latency_ms']}ms ✓"
        )

    def test_05_celery_task_id_persisted(self, token):
        """Verify celery_task_id was written to the model record (enables external polling)."""
        model_id = TestTrainingWorkerPipeline._model_id
        r = requests.get(
            f"{MODEL_BASE}/{model_id}",
            headers=_auth_headers(token),
            timeout=10,
        )
        body = r.json()
        task_id = body.get("celery_task_id")
        assert task_id and len(task_id) > 10, (
            f"celery_task_id not persisted or too short: {task_id!r}"
        )
        print(f"\n  [TASK ID] celery_task_id={task_id} ✓")

    def test_06_cold_start_prediction_completes_within_timeout(self, token):
        """
        Validate that the FIRST inference request on a ready model (Tier 1 cold start)
        completes within COLD_START_TIMEOUT_S seconds.

        Regression guard for Issue #1 (blocking Supabase download):
          - OLD behaviour: supabase.download() ran synchronously on the event loop,
            blocking ALL other requests for the duration of the download (1–5s per
            model per replica).  Under load this caused cascading timeouts.
          - NEW behaviour: _load_model_artifact() runs inside asyncio.to_thread(),
            keeping the event loop free.  The first cold-start load is I/O-bound
            but non-blocking; all subsequent requests hit Tier 1 RAM instantly.

        We use a tight 10-second wall-clock timeout.  A real blocking download would
        miss this on even a modest Supabase latency; a thread-pool load of a
        small model from the local volume completes in well under 1 second.
        """
        import concurrent.futures
        import threading

        COLD_START_TIMEOUT_S = 10  # seconds — deliberately tight

        model_id = TestTrainingWorkerPipeline._model_id
        feature_cols = getattr(TestTrainingWorkerPipeline, "_columns", [])

        # Fetch a valid sample row from model metrics
        r = requests.get(f"{MODEL_BASE}/{model_id}", headers=_auth_headers(token), timeout=10)
        assert r.status_code == 200
        sample_data = r.json()["metrics"].get("sample_data", [])
        assert sample_data, "No sample_data in metrics — cannot build prediction payload"

        payload = {"model_id": model_id, "input_data": sample_data[0]}

        result = {}
        def _run():
            resp = requests.post(
                f"{PRED_BASE}/predict",
                headers=_auth_headers(token),
                json=payload,
                timeout=COLD_START_TIMEOUT_S + 2,
            )
            result["status_code"] = resp.status_code
            result["body"] = resp.json()

        t = threading.Thread(target=_run)
        t.start()
        t.join(timeout=COLD_START_TIMEOUT_S)

        assert not t.is_alive(), (
            f"Cold-start prediction did NOT complete within {COLD_START_TIMEOUT_S}s. "
            "This indicates the event loop was blocked (blocking I/O regression)."
        )
        assert result.get("status_code") == 201, (
            f"Prediction returned unexpected status: {result.get('status_code')} "
            f"body={result.get('body')}"
        )
        latency = result["body"].get("latency_ms", 9999)
        print(f"\n  [COLD START] Prediction completed in {latency}ms (wall-clock < {COLD_START_TIMEOUT_S}s) ✓")

    def test_07_concurrent_predictions_no_thundering_herd(self, token):
        """
        Fire N_CONCURRENT requests for the same model simultaneously and assert
        all of them succeed.

        Regression guard for Issue #2 (no stampede protection on IN_MEMORY_MODEL_CACHE):
          - OLD behaviour: N concurrent cold-start requests each independently called
            supabase.download(), triggering N simultaneous blocking downloads for the
            same model.  This exhausted thread/connection pools and caused failures.
          - NEW behaviour: model_cache.get_model() is guarded by an asyncio.Lock.
            The first coroutine performs the load; all others await the lock and receive
            the already-populated cached artifact — exactly ONE download regardless of N.

        We assert that ALL N requests succeed (status 201 or 202).  If the lock were
        missing or the old blocking code were present, some requests would time out or
        return 500 under moderate concurrency.
        """
        import concurrent.futures

        N_CONCURRENT = 10
        model_id = TestTrainingWorkerPipeline._model_id

        r = requests.get(f"{MODEL_BASE}/{model_id}", headers=_auth_headers(token), timeout=10)
        sample_data = r.json()["metrics"].get("sample_data", [])
        assert sample_data

        batch_payload = {"model_id": model_id, "input_data": sample_data[:1]}

        def _fire_batch():
            resp = requests.post(
                f"{PRED_BASE}/batch",
                headers=_auth_headers(token),
                json=batch_payload,
                timeout=30,
            )
            return resp.status_code, resp.json()

        with concurrent.futures.ThreadPoolExecutor(max_workers=N_CONCURRENT) as pool:
            futures = [pool.submit(_fire_batch) for _ in range(N_CONCURRENT)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        successes = [r for r in results if r[0] == 202]
        failures  = [r for r in results if r[0] != 202]

        print(
            f"\n  [CONCURRENT] {len(successes)}/{N_CONCURRENT} succeeded, "
            f"{len(failures)} failed"
        )
        assert len(failures) == 0, (
            f"Thundering-herd regression: {len(failures)}/{N_CONCURRENT} concurrent "
            f"requests failed. Failures: {failures[:3]}"
        )


# ---------------------------------------------------------------------------
# Standalone runner (python tests/test_worker_pipeline.py)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print(" ML Platform — Celery Pipeline Integration Test")
    print(f" Target cluster: {API_BASE}")
    print("=" * 60)

    try:
        tok = _register_or_login()
        ds_id, cols = _upload_dataset(tok)
        target_col = [c for c in cols if c.lower() not in ("unnamed: 0", "id", "index")][0]

        print(f"\n[STEP 1] Dispatching training task → target={target_col!r}")
        r = requests.post(
            f"{MODEL_BASE}/train",
            headers=_auth_headers(tok),
            json={
                "name": f"smoke-test-{uuid.uuid4().hex[:6]}",
                "dataset_id": ds_id,
                "target_column": target_col,
                "algorithm": "random_forest",
                "training_params": {"n_estimators": 10, "max_depth": 5},
            },
            timeout=15,
        )
        r.raise_for_status()
        model_id = r.json()["model_id"]
        print(f"         model_id={model_id[:8]}… status=training")

        print(f"\n[STEP 2] Polling for terminal state (timeout={POLL_TIMEOUT}s)…")
        final = _poll_model_status(tok, model_id)
        if final["status"] != "ready":
            print(f"\n✗ FAILED — model status={final['status']!r}")
            sys.exit(1)

        print(f"\n[STEP 3] Dispatching batch prediction…")
        feature_cols = final["metrics"].get("feature_columns", [])
        sample_data  = final["metrics"].get("sample_data", [])
        r = requests.post(
            f"{PRED_BASE}/batch",
            headers=_auth_headers(tok),
            json={"model_id": model_id, "input_data": [sample_data[0]]},
            timeout=30,
        )
        r.raise_for_status()
        print(f"         {r.json()}")

        print("\n" + "=" * 60)
        print(" ✅  ALL PIPELINE STAGES PASSED")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
