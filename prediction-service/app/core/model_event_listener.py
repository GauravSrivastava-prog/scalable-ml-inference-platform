"""
Redis Pub/Sub listener — event-driven model cache warming.

Problem solved
--------------
Without this module, every prediction-service replica maintains its own
cold model cache independently.  After a model finishes training:

  Old behaviour (broken):
    Replica 1: CACHE MISS → downloads from Supabase (1–5 s) → stores locally
    Replica 2: CACHE MISS → downloads from Supabase (1–5 s) → stores locally
    Replica N: CACHE MISS → downloads from Supabase (1–5 s) → stores locally
    ↳  N replicas × download latency × Supabase bandwidth, all on the hot path.

  New behaviour (fixed):
    Celery worker publishes {"local_path": "...", "model_id": "..."}
    to the ``model.ready`` Redis channel immediately after training completes.

    Every live prediction-service replica subscribes to this channel.
    On receiving the event, each replica pre-warms its local LRU cache
    from the shared Docker volume (no network I/O, sub-ms disk read is
    offloaded to the thread pool).

    Result: By the time the first real inference request arrives,
    Tier 1 is already warm on ALL replicas — zero blocking cold starts.

Message contract
----------------
Publisher : model-service/app/services/training.py  (Celery worker)
Channel   : ``model.ready``
Payload   : JSON string
            {
              "local_path": "models/{user_id}/{name}/vN.joblib",
              "model_id":   "<uuid-string>"
            }

Lifecycle
---------
This coroutine is spawned as an asyncio.Task in the prediction-service
lifespan (main.py).  It reconnects automatically on Redis errors with
exponential back-off and shuts down cleanly on asyncio.CancelledError.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from app.core.cache_instance import model_cache
from app.core.redis_client import redis_cache

logger = logging.getLogger(__name__)

# Redis Pub/Sub channel that the Celery worker publishes to
PUBSUB_CHANNEL = "model.ready"

# Root of the shared Docker volume inside the prediction-service container
STORAGE_ROOT = "/app/storage"


# ---------------------------------------------------------------------------
# Public entry point — spawned as an asyncio.Task in lifespan()
# ---------------------------------------------------------------------------

async def start_model_event_listener() -> None:
    """
    Subscribe to the ``model.ready`` Redis Pub/Sub channel and pre-warm the
    local model cache whenever a new artifact becomes available on the volume.

    Error handling
    --------------
    Any exception (Redis connection drop, malformed message) is caught and
    logged.  The loop reconnects with exponential back-off (1 s → 2 s → … → 60 s)
    so a transient Redis blip never kills the prediction-service process.
    """
    backoff_seconds = 1

    while True:
        pubsub = None
        try:
            if not redis_cache.client:
                logger.warning(
                    "[EVENT LISTENER] Redis client not ready — retrying in %ds", backoff_seconds
                )
                await asyncio.sleep(backoff_seconds)
                backoff_seconds = min(backoff_seconds * 2, 60)
                continue

            pubsub = redis_cache.client.pubsub()
            await pubsub.subscribe(PUBSUB_CHANNEL)
            logger.info("[EVENT LISTENER] Subscribed to Redis channel '%s' ✓", PUBSUB_CHANNEL)
            backoff_seconds = 1  # reset on successful connection

            async for raw_message in pubsub.listen():
                # pubsub.listen() yields subscribe/unsubscribe confirmations too;
                # we only care about actual data messages.
                if raw_message["type"] != "message":
                    continue

                # Fire-and-forget: pre-warm in the background so the listener
                # loop immediately returns to awaiting the next message.
                asyncio.create_task(
                    _handle_model_ready_event(raw_message["data"]),
                    name="cache_warm",
                )

        except asyncio.CancelledError:
            # Raised by the lifespan shutdown — exit cleanly.
            logger.info("[EVENT LISTENER] Received cancellation — shutting down.")
            break
        except Exception as exc:
            logger.error(
                "[EVENT LISTENER] Unexpected error: %s — reconnecting in %ds",
                exc, backoff_seconds,
            )
            await asyncio.sleep(backoff_seconds)
            backoff_seconds = min(backoff_seconds * 2, 60)
        finally:
            if pubsub:
                try:
                    await pubsub.unsubscribe(PUBSUB_CHANNEL)
                    await pubsub.aclose()
                except Exception:
                    pass  # best-effort cleanup on exit


# ---------------------------------------------------------------------------
# Internal handler — called per message
# ---------------------------------------------------------------------------

async def _handle_model_ready_event(data: Any) -> None:
    """
    Parse a ``model.ready`` message payload and pre-warm the local LRU cache.

    This function intentionally swallows all exceptions: a bad or unexpected
    message must never crash the listener loop.
    """
    try:
        payload: dict = json.loads(data)
        relative_path: str = payload.get("local_path", "")
        model_id: str = payload.get("model_id", "unknown")

        if not relative_path:
            logger.warning(
                "[EVENT LISTENER] Received model.ready with empty local_path — skipping."
            )
            return

        local_path = os.path.join(STORAGE_ROOT, relative_path)

        if not os.path.isfile(local_path):
            # The shared volume may have a brief propagation delay in some
            # setups (e.g. distributed NFS).  Log and skip — the next real
            # inference request will trigger a normal cache-miss load.
            logger.warning(
                "[EVENT LISTENER] model.ready for model %s but file not yet "
                "visible on volume: %s",
                model_id[:8], local_path,
            )
            return

        logger.info(
            "[EVENT LISTENER] model.ready → pre-warming cache for model %s …", model_id[:8]
        )
        # get_model() offloads joblib.load to the thread pool — non-blocking.
        await model_cache.get_model(local_path=local_path)
        logger.info(
            "[EVENT LISTENER] ✓ Cache pre-warmed for model %s", model_id[:8]
        )

    except Exception as exc:
        logger.error(
            "[EVENT LISTENER] Failed to handle model.ready event: %s", exc, exc_info=True
        )
