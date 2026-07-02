"""
Unified LRU model artifact cache.

Design notes
------------
asyncio.Lock
    Serialises concurrent loads for the same cache key.  Without the lock,
    50 simultaneous requests on a cold model would each trigger an independent
    download / joblib.load — the classic thundering-herd problem.  With the
    lock, only the first coroutine calls _load_model_artifact(); all others
    await the lock and find the entry already populated.

asyncio.to_thread
    _load_model_artifact() is a plain synchronous function so it can be safely
    called from a thread-pool worker via asyncio.to_thread().  This keeps ALL
    blocking work (joblib deserialization, supabase HTTP download) off the
    event loop, allowing other requests to be served while a model is loading.

Supabase fallback
    If the local shared-volume file is absent (e.g. a cloud deployment with no
    shared volume), the loader transparently downloads from Supabase Storage.
    The Supabase client is synchronous, but because the call runs inside the
    thread pool it never stalls the event loop.

invalidate(path)
    Called by the model-delete endpoint so stale artifacts are evicted
    immediately; the next inference request re-loads from the refreshed file.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from collections import OrderedDict
from typing import Any

import joblib

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Thread-pool loader — runs inside asyncio.to_thread(), safe to block here
# ---------------------------------------------------------------------------

def _load_model_artifact(
    local_path: str,
    supabase_url: str | None = None,
    supabase_key: str | None = None,
    cloud_path: str | None = None,
) -> Any:
    """
    Load a serialised model artifact.

    Resolution order
    ----------------
    1. Local shared volume  (fastest — no network; preferred path)
    2. Supabase Storage     (cloud fallback — requires credentials + cloud_path)

    This function is SYNCHRONOUS by design.  It is always invoked via
    ``asyncio.to_thread()`` so the calling event loop is never blocked.

    Raises
    ------
    FileNotFoundError — if the artifact is absent on the local volume and no
                        Supabase credentials were supplied.
    """
    # ── Tier 1A: local shared Docker / NFS volume ──────────────────────────
    if os.path.isfile(local_path):
        logger.info("[MODEL LOADER] Local volume hit → %s", os.path.basename(local_path))
        return joblib.load(local_path)

    # ── Tier 1B: Supabase Storage (cloud fallback) ─────────────────────────
    if supabase_url and supabase_key and cloud_path:
        logger.info(
            "[MODEL LOADER] Local file absent — downloading from Supabase: %s", cloud_path
        )
        # Import here (not at module level) to avoid supabase-py pulling in
        # its sync HTTP stack when the module is first loaded.
        from supabase import create_client  # noqa: PLC0415

        client = create_client(supabase_url, supabase_key)
        file_bytes: bytes = client.storage.from_("models").download(cloud_path)
        return joblib.load(io.BytesIO(file_bytes))

    raise FileNotFoundError(
        f"Model artifact not found at '{local_path}' and no Supabase "
        "credentials were provided for cloud fallback."
    )


# ---------------------------------------------------------------------------
# LRU Model Cache
# ---------------------------------------------------------------------------

class ModelCache:
    """
    Process-local LRU cache for deserialised ML model artifacts.

    Key properties
    --------------
    max_size      Evicts the least-recently-used model when the cache is full,
                  bounding memory consumption regardless of model diversity.
    asyncio.Lock  Serialises concurrent loads for the same key — thundering-herd
                  prevention.  Only the first coroutine runs the loader; the rest
                  await the lock and receive the already-populated entry.
    Non-blocking  All I/O (disk read, supabase download, joblib parse) is
                  delegated to asyncio.to_thread() — the event loop stays free.
    invalidate()  Lets the delete endpoint evict a stale entry immediately.
    """

    def __init__(self, max_size: int = 5) -> None:
        self.cache: OrderedDict[str, Any] = OrderedDict()
        self.max_size = max_size
        # Single lock guards both hit (move_to_end) and miss (load + insert)
        # paths so the cache stays consistent under concurrent access.
        self.lock = asyncio.Lock()

    async def get_model(
        self,
        local_path: str,
        supabase_url: str | None = None,
        supabase_key: str | None = None,
        cloud_path: str | None = None,
    ) -> Any:
        """
        Return a cached model artifact, loading it if necessary.

        Parameters
        ----------
        local_path    Absolute path to the .joblib file on the shared volume.
                      Example: ``/app/storage/models/{user_id}/{name}/v1.joblib``
        supabase_url  Value of the SUPABASE_URL environment variable (optional).
        supabase_key  Value of the SUPABASE_KEY environment variable (optional).
        cloud_path    Path inside the Supabase 'models' bucket (optional).
                      Example: ``{user_id}/{model_name}/v1.joblib``
        """
        async with self.lock:
            # ── Cache hit — promote to MRU position ─────────────────────────
            if local_path in self.cache:
                self.cache.move_to_end(local_path)
                logger.info(
                    "[TIER 1 HIT] Serving from RAM: %s", os.path.basename(local_path)
                )
                return self.cache[local_path]

            # ── Cache miss — load in thread pool, keep event loop free ───────
            logger.info("[TIER 1 MISS] Loading: %s", os.path.basename(local_path))
            model = await asyncio.to_thread(
                _load_model_artifact,
                local_path,
                supabase_url,
                supabase_key,
                cloud_path,
            )

            # Insert and promote to MRU end
            self.cache[local_path] = model
            self.cache.move_to_end(local_path)

            # ── Evict LRU entry if over capacity ─────────────────────────────
            if len(self.cache) > self.max_size:
                evicted_path, _ = self.cache.popitem(last=False)
                logger.info(
                    "[CACHE EVICT] LRU evicted: %s", os.path.basename(evicted_path)
                )

            return model

    def invalidate(self, local_path: str) -> bool:
        """
        Remove a specific entry from the cache.

        Returns True if the entry existed and was removed, False otherwise.
        Note: no lock needed here — dict deletion in CPython is atomic under
        the GIL, and this is called from async context where the lock is not held.
        """
        if local_path in self.cache:
            del self.cache[local_path]
            logger.info("[CACHE INVALIDATE] Evicted: %s", os.path.basename(local_path))
            return True
        return False

    @property
    def size(self) -> int:
        """Number of models currently held in RAM."""
        return len(self.cache)