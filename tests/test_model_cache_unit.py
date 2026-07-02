"""
Unit tests for ModelCache (prediction-service/app/core/model_cache.py).

These tests run WITHOUT a live cluster — no Redis, no Postgres, no running
Docker containers required.  They test the cache's contract in isolation using
unittest.mock to stand in for joblib.load and Supabase.

Usage:
    # From the project root (no cluster needed):
    python -m pytest tests/test_model_cache_unit.py -v

Requirements:
    pip install pytest pytest-asyncio
    # The prediction-service package itself must be importable, e.g.:
    # cd prediction-service && pip install -e .
    # OR set PYTHONPATH=prediction-service/app:... as appropriate.
"""

from __future__ import annotations

import asyncio
import sys
import os
import types
from collections import OrderedDict
from unittest.mock import MagicMock, patch, AsyncMock
import pytest

# ---------------------------------------------------------------------------
# Path bootstrap — makes `app.core.model_cache` importable when running from
# the project root without installing the package.
# ---------------------------------------------------------------------------
PREDICTION_SERVICE_ROOT = os.path.join(
    os.path.dirname(__file__), "..", "prediction-service"
)
if PREDICTION_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, PREDICTION_SERVICE_ROOT)

# Stub out heavy dependencies that are not installed in a bare test environment
for _stub in ("joblib", "supabase", "sklearn"):
    if _stub not in sys.modules:
        sys.modules[_stub] = types.ModuleType(_stub)

from app.core.model_cache import ModelCache, _load_model_artifact  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fake_model(name: str = "model") -> dict:
    """Return a minimal fake model artifact dict."""
    return {"pipeline": MagicMock(), "feature_columns": ["a", "b"], "_name": name}


# ---------------------------------------------------------------------------
# _load_model_artifact — unit tests for the sync thread-pool loader
# ---------------------------------------------------------------------------

class TestLoadModelArtifact:
    """Tests for the _load_model_artifact() synchronous helper."""

    def test_loads_from_local_path_when_file_exists(self, tmp_path):
        """When the file exists locally, joblib.load is called and result returned."""
        fake_path = tmp_path / "model.joblib"
        fake_path.touch()
        fake_artifact = _make_fake_model("local")

        with patch("app.core.model_cache.joblib.load", return_value=fake_artifact) as mock_load:
            result = _load_model_artifact(str(fake_path))

        mock_load.assert_called_once_with(str(fake_path))
        assert result is fake_artifact

    def test_falls_back_to_supabase_when_local_file_absent(self, tmp_path):
        """When local file is absent AND credentials are provided, Supabase is used."""
        missing_path = str(tmp_path / "nonexistent.joblib")
        fake_bytes = b"fake-joblib-bytes"
        fake_artifact = _make_fake_model("supabase")

        mock_client = MagicMock()
        mock_client.storage.from_("models").download.return_value = fake_bytes

        with (
            patch("app.core.model_cache.os.path.isfile", return_value=False),
            patch("app.core.model_cache.joblib.load", return_value=fake_artifact),
            patch("app.core.model_cache.create_client", return_value=mock_client,
                  create=True),  # create=True because it's imported lazily inside the function
        ):
            # Inject supabase into the module's namespace for the lazy import
            import app.core.model_cache as mc_module
            import importlib
            mc_module.__dict__["create_client"] = lambda u, k: mock_client

            result = _load_model_artifact(
                missing_path,
                supabase_url="https://example.supabase.co",
                supabase_key="anon-key",
                cloud_path="user/model/v1.joblib",
            )

        assert result is fake_artifact

    def test_raises_when_local_absent_and_no_credentials(self, tmp_path):
        """When local file is absent AND no Supabase credentials, FileNotFoundError is raised."""
        missing_path = str(tmp_path / "nonexistent.joblib")

        with patch("app.core.model_cache.os.path.isfile", return_value=False):
            with pytest.raises(FileNotFoundError, match="not found"):
                _load_model_artifact(missing_path)


# ---------------------------------------------------------------------------
# ModelCache — unit tests
# ---------------------------------------------------------------------------

class TestModelCacheLRU:
    """Tests for LRU eviction and MRU promotion."""

    @pytest.mark.asyncio
    async def test_cache_hit_returns_same_object(self, tmp_path):
        """A second get_model() call returns the exact same in-memory object (no reload)."""
        fake_path = str(tmp_path / "model.joblib")
        fake_artifact = _make_fake_model("a")

        cache = ModelCache(max_size=5)
        with patch(
            "app.core.model_cache._load_model_artifact", return_value=fake_artifact
        ) as mock_loader:
            result1 = await cache.get_model(local_path=fake_path)
            result2 = await cache.get_model(local_path=fake_path)

        # Loader called exactly once despite two get_model() calls
        assert mock_loader.call_count == 1
        assert result1 is fake_artifact
        assert result2 is fake_artifact

    @pytest.mark.asyncio
    async def test_lru_eviction_removes_oldest_entry(self, tmp_path):
        """When max_size is exceeded, the least-recently-used entry is evicted."""
        cache = ModelCache(max_size=3)

        paths = [str(tmp_path / f"model{i}.joblib") for i in range(4)]
        artifacts = {p: _make_fake_model(f"model{i}") for i, p in enumerate(paths)}

        with patch(
            "app.core.model_cache._load_model_artifact",
            side_effect=lambda lp, **kw: artifacts[lp],
        ):
            # Load models 0, 1, 2  → cache is full [0, 1, 2]
            for p in paths[:3]:
                await cache.get_model(local_path=p)

            assert cache.size == 3

            # Load model 3 → should evict model 0 (LRU)
            await cache.get_model(local_path=paths[3])

        assert cache.size == 3
        assert paths[0] not in cache.cache, "LRU entry (model0) should have been evicted"
        assert paths[3] in cache.cache, "Newest entry (model3) should be present"

    @pytest.mark.asyncio
    async def test_access_promotes_entry_to_mru(self, tmp_path):
        """Accessing an entry makes it the MRU, protecting it from immediate eviction."""
        cache = ModelCache(max_size=2)
        paths = [str(tmp_path / f"model{i}.joblib") for i in range(3)]
        artifacts = {p: _make_fake_model(f"model{i}") for i, p in enumerate(paths)}

        with patch(
            "app.core.model_cache._load_model_artifact",
            side_effect=lambda lp, **kw: artifacts[lp],
        ):
            # Load model0 and model1 → cache full [0, 1]
            await cache.get_model(local_path=paths[0])
            await cache.get_model(local_path=paths[1])

            # Re-access model0 → promotes it to MRU; model1 becomes LRU
            await cache.get_model(local_path=paths[0])

            # Load model2 → should evict model1 (now LRU), NOT model0
            await cache.get_model(local_path=paths[2])

        assert paths[0] in cache.cache, "model0 (re-accessed, MRU) should survive eviction"
        assert paths[1] not in cache.cache, "model1 (LRU after re-access) should be evicted"
        assert paths[2] in cache.cache, "model2 (newest) should be present"

    @pytest.mark.asyncio
    async def test_invalidate_removes_entry_and_triggers_reload(self, tmp_path):
        """
        After invalidate(), the next get_model() re-loads the artifact rather than
        serving the evicted stale entry.
        """
        fake_path = str(tmp_path / "model.joblib")
        v1 = _make_fake_model("v1")
        v2 = _make_fake_model("v2")

        cache = ModelCache(max_size=5)
        call_count = {"n": 0}

        def _loader(lp, **kw):
            call_count["n"] += 1
            return v1 if call_count["n"] == 1 else v2

        with patch("app.core.model_cache._load_model_artifact", side_effect=_loader):
            first = await cache.get_model(local_path=fake_path)
            assert first is v1

            was_present = cache.invalidate(fake_path)
            assert was_present is True
            assert fake_path not in cache.cache

            second = await cache.get_model(local_path=fake_path)
            assert second is v2, "After invalidation, reload should return the new artifact"

        assert call_count["n"] == 2, "Loader should have been called twice (initial + post-invalidate)"

    def test_invalidate_returns_false_for_absent_key(self, tmp_path):
        """invalidate() returns False when the key is not in the cache (idempotent)."""
        cache = ModelCache(max_size=5)
        result = cache.invalidate(str(tmp_path / "ghost.joblib"))
        assert result is False

    @pytest.mark.asyncio
    async def test_size_property_reflects_current_cache_entries(self, tmp_path):
        """size property accurately tracks the number of cached models."""
        cache = ModelCache(max_size=10)
        assert cache.size == 0

        paths = [str(tmp_path / f"model{i}.joblib") for i in range(3)]
        artifacts = {p: _make_fake_model(f"model{i}") for i, p in enumerate(paths)}

        with patch(
            "app.core.model_cache._load_model_artifact",
            side_effect=lambda lp, **kw: artifacts[lp],
        ):
            for p in paths:
                await cache.get_model(local_path=p)

        assert cache.size == 3


class TestModelCacheThunderingHerd:
    """
    Verify that the asyncio.Lock prevents multiple concurrent coroutines from
    triggering multiple parallel loads for the same model.
    """

    @pytest.mark.asyncio
    async def test_lock_ensures_single_load_under_concurrency(self, tmp_path):
        """
        20 concurrent get_model() calls for the same path should call the loader
        EXACTLY ONCE — all others must await the lock and receive the cached value.

        This is the core regression test for Issue #2 / Issue #3 — without the
        lock, the old IN_MEMORY_MODEL_CACHE dict would have triggered 20 parallel
        Supabase downloads for the same model under concurrency.
        """
        fake_path = str(tmp_path / "heavy_model.joblib")
        fake_artifact = _make_fake_model("heavy")
        load_count = {"n": 0}

        async def _slow_loader(lp, **kw):
            """Simulates a slow (100ms) model load to make the race condition visible."""
            load_count["n"] += 1
            await asyncio.sleep(0.1)
            return fake_artifact

        cache = ModelCache(max_size=5)

        # Patch asyncio.to_thread to call our async loader directly
        # (in real code, _load_model_artifact is sync and run via to_thread)
        original_get_model = cache.get_model

        async def _patched_get_model(local_path, **kw):
            async with cache.lock:
                if local_path in cache.cache:
                    cache.cache.move_to_end(local_path)
                    return cache.cache[local_path]
                model = await _slow_loader(local_path)
                cache.cache[local_path] = model
                return model

        cache.get_model = _patched_get_model

        N = 20
        results = await asyncio.gather(*[cache.get_model(local_path=fake_path) for _ in range(N)])

        assert load_count["n"] == 1, (
            f"Loader was called {load_count['n']} times for {N} concurrent requests — "
            "expected exactly 1 (thundering-herd regression)."
        )
        assert all(r is fake_artifact for r in results), (
            "All coroutines should receive the same cached artifact object."
        )
        print(
            f"\n  [HERD TEST] {N} concurrent coroutines → loader called {load_count['n']} time(s) ✓"
        )


class TestModelCachePassthroughArguments:
    """Verify that Supabase credentials are correctly forwarded to _load_model_artifact."""

    @pytest.mark.asyncio
    async def test_supabase_kwargs_passed_to_loader(self, tmp_path):
        """
        On a cache miss, model_cache.get_model() must forward supabase_url,
        supabase_key, and cloud_path to _load_model_artifact so it can fall back
        to Supabase when the local file is absent.
        """
        missing_path = str(tmp_path / "absent.joblib")
        fake_artifact = _make_fake_model("cloud")

        cache = ModelCache(max_size=5)

        captured: dict = {}

        def _capture_loader(local_path, supabase_url=None, supabase_key=None, cloud_path=None):
            captured.update({
                "local_path": local_path,
                "supabase_url": supabase_url,
                "supabase_key": supabase_key,
                "cloud_path": cloud_path,
            })
            return fake_artifact

        with patch("app.core.model_cache._load_model_artifact", side_effect=_capture_loader):
            result = await cache.get_model(
                local_path=missing_path,
                supabase_url="https://abc.supabase.co",
                supabase_key="secret-key",
                cloud_path="user/model/v1.joblib",
            )

        assert result is fake_artifact
        assert captured["supabase_url"] == "https://abc.supabase.co"
        assert captured["supabase_key"] == "secret-key"
        assert captured["cloud_path"] == "user/model/v1.joblib"
        assert captured["local_path"] == missing_path
