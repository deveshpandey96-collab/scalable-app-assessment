import { LRUCache } from "../lru-cache/LRUCache.js";
import { RedisCache } from "./RedisCache.js";

/**
 * L1 = in-process LRU (nanoseconds, per instance)
 * L2 = Redis (shared across instances, ~1ms)
 *
 * Writes/invalidations delete from L2 and broadcast on a pub/sub channel so every
 * other instance drops its L1 copy. There is a brief staleness window (message latency);
 * keep L1 small and consider a short L1 TTL as a safety net if a message is lost.
 */
export class TwoTierCache {
  constructor({ l1Capacity = 1000, l2, publisher, subscriber, channel = "cache:invalidate", instanceId }) {
    if (!(l2 instanceof RedisCache)) throw new TypeError("l2 must be a RedisCache");
    this.l1 = new LRUCache(l1Capacity);
    this.l2 = l2;
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.channel = channel;
    this.instanceId = instanceId ?? `${process.pid}-${Math.random().toString(36).slice(2)}`;
  }

  async init() {
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on("message", (channel, message) => {
      if (channel !== this.channel) return;
      const { key, origin } = JSON.parse(message);
      if (origin !== this.instanceId) this.l1.delete(key);
    });
  }

  async get(key, loader) {
    const local = this.l1.get(key);
    if (local !== undefined) return local;                 // L1 hit
    const value = await this.l2.getOrLoad(key, loader);    // L2 hit or DB load
    if (value !== undefined) this.l1.put(key, value);
    return value;
  }

  /** Call on every write to the underlying record: delete, don't update. */
  async invalidate(key) {
    this.l1.delete(key);
    await this.l2.del(key);
    await this.publisher.publish(this.channel, JSON.stringify({ key, origin: this.instanceId }));
  }
}
