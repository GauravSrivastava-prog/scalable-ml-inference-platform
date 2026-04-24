import asyncio
import logging
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from app.core.redis_client import redis_cache
from ml_platform_core.database import async_session_factory
from ml_platform_core.models.user_analytics import UserAnalytics

logger = logging.getLogger("prediction-service.sync_worker")

async def flush_telemetry_to_db():
    """Runs infinitely in the background, flushing Redis telemetry to PostgreSQL safely."""
    while True:
        try:
            await asyncio.sleep(300) # Run every 5 minutes
            
            if not redis_cache.client:
                continue
                
            keys = []
            # Non-blocking SCAN prevents Redis latency spikes
            async for key in redis_cache.client.scan_iter("user_stats:*", count=100):
                keys.append(key)
                
            if not keys:
                continue

            for key in keys:
                # Strict UUID casting for asyncpg
                user_id_str = key.split(":")[1]
                user_uuid = uuid.UUID(user_id_str)
                
                # 1. Read current value (Do not reset yet!)
                pending_hits_raw = await redis_cache.client.hget(key, "pending_cache_hits")
                pending_hits = int(pending_hits_raw) if pending_hits_raw else 0
                
                if pending_hits > 0:
                    # 2. Narrow session scope (open, write, commit, close per user)
                    async with async_session_factory() as db:
                        stmt = insert(UserAnalytics).values(
                            user_id=user_uuid, 
                            total_cache_hits=pending_hits
                        )
                        stmt = stmt.on_conflict_do_update(
                            index_elements=['user_id'],
                            set_={'total_cache_hits': UserAnalytics.total_cache_hits + stmt.excluded.total_cache_hits}
                        )
                        await db.execute(stmt)
                        await db.commit() # Wait for DB confirmation!
                    
                    # 3. ONLY AFTER successful DB commit, safely decrement Redis
                    try:
                        await redis_cache.client.hincrby(key, "pending_cache_hits", -pending_hits)
                    except Exception as redis_err:
                        logger.error(
                            f"[SYNC WORKER] CRITICAL: Failed to decrement Redis for {key} after DB commit. "
                            f"Risk of double-counting {pending_hits} hits: {redis_err}"
                        )

        except asyncio.CancelledError:
            logger.info("[SYNC WORKER] Shutting down gracefully.")
            break
        except Exception as e:
            logger.error(f"[SYNC WORKER] Encountered an error during flush: {e}")