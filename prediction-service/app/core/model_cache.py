from collections import OrderedDict
import joblib
import asyncio


class ModelCache:
    def __init__(self, max_size: int = 5):
        self.cache = OrderedDict()
        self.max_size = max_size
        self.lock = asyncio.Lock()

    async def get_model(self, model_path: str):
        """
        Retrieve model from cache or load it if not present
        """

        async with self.lock:

            if model_path in self.cache:
                self.cache.move_to_end(model_path)
                print(f"[CACHE HIT] {model_path}")
                return self.cache[model_path]

            print("[CACHE MISS] loading model from disk")

            # Run blocking IO in thread pool
            model = await asyncio.to_thread(joblib.load, model_path)

            self.cache[model_path] = model

            if len(self.cache) > self.max_size:
                evicted = self.cache.popitem(last=False)
                print(f"[CACHE EVICT] {evicted[0]}")

            return model