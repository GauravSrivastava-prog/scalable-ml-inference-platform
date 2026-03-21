import redis.asyncio as redis
import logging

logger = logging.getLogger(__name__)

class RedisPredictionCache:
    def __init__(self):
        self.client = None

    async def connect(self, url: str = "redis://redis:6379/0"):
        """Initialize the Redis connection pool."""
        # decode_responses=True means Redis returns strings, not raw bytes
        self.client = redis.from_url(url, decode_responses=True) 
        logger.info("Connected to Redis Prediction Cache (Tier 2).")

    async def close(self):
        """Close the connection pool cleanly."""
        if self.client:
            await self.client.aclose()

# Singleton instance
redis_cache = RedisPredictionCache()