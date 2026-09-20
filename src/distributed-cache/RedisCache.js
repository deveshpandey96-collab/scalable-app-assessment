/**
 * Shared cache (L2) using the cache-aside pattern.
 * `redis` is any ioredis-compatible client: get / set(key, val, "EX", ttl) / del.
 *
 * Production Redis config for eviction:
 *   maxmemory 2gb
 *   maxmemory-policy allkeys-lru     (approximate LRU via sampling)
 *
 * Built-in protections:
 *  - TTL with jitter          -> keys don't all expire at the same instant (stampede)
 *  - single-flight per key    -> concurrent misses on one instance trigger ONE loader call
 *  - fail-open                -> Redis outage degrades to DB reads instead of an outage
 */
export class RedisCache {
  constructor({ redis, ttlSeconds = 300, jitterRatio = 0.1, namespace = "cache", logger = console }) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
    this.jitterRatio = jitterRatio;
    this.ns = namespace;
    this.logger = logger;
    this.inflight = new Map();
  }

  _k(key) {
    return `${this.ns}:${key}`;
  }

  _ttl() {
    const jitter = 1 + (Math.random() * 2 - 1) * this.jitterRatio;
    return Math.max(1, Math.round(this.ttlSeconds * jitter));
  }

  async get(key) {
    try {
      const raw = await this.redis.get(this._k(key));
      return raw == null ? undefined : JSON.parse(raw);
    } catch (err) {
      this.logger.warn?.("cache.get_failed", { error: err.message });
      return undefined; // fail open
    }
  }

  async set(key, value) {
    try {
      await this.redis.set(this._k(key), JSON.stringify(value), "EX", this._ttl());
    } catch (err) {
      this.logger.warn?.("cache.set_failed", { error: err.message });
    }
  }

  async del(key) {
    try {
      await this.redis.del(this._k(key));
    } catch (err) {
      this.logger.warn?.("cache.del_failed", { error: err.message });
    }
  }

  /** Read-through: return cached value or load it from the source of truth and cache it. */
  async getOrLoad(key, loader) {
    const cached = await this.get(key);
    if (cached !== undefined) return cached;

    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = (async () => {
      const value = await loader();
      if (value !== undefined) await this.set(key, value);
      return value;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}
