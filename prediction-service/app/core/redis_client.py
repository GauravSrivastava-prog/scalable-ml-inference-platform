import redis.asyncio as redis
import logging
import os

logger = logging.getLogger(__name__)

class RedisPredictionCache:
    def __init__(self):
        self.client = None

    async def connect(self, url: str = None):
        """Initialize the Redis connection pool."""
        # Check the environment exactly when we need to connect
        final_url = url or os.getenv("REDIS_URL", "redis://redis:6379/0")
        
        self.client = redis.from_url(final_url, decode_responses=True) 
        logger.info("Connected to Redis Prediction Cache (Tier 2).")

    async def close(self):
        """Close the connection pool cleanly."""
        if self.client:
            await self.client.aclose()

# Singleton instance
redis_cache = RedisPredictionCache()