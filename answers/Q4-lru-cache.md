# Q4. Design & Build: LRU Cache

Code: [`src/lru-cache/`](../src/lru-cache/) and [`src/distributed-cache/`](../src/distributed-cache/). Tests: [`tests/lru.test.js`](../tests/lru.test.js), [`tests/distributedCache.test.js`](../tests/distributedCache.test.js).

## a) Implementation

`src/lru-cache/LRUCache.js` is a **hash map + doubly linked list** with sentinel head/tail nodes. `src/lru-cache/MapLRUCache.js` is a compact alternative using `Map`'s insertion order. A randomized test proves both behave identically over 20,000 operations.

```js
get(key)  { node = map.get(key); if (!node) return undefined;
            unlink(node); pushFront(node); return node.value; }

put(key, value) { if key exists → update value, move to front
                  else { if size == capacity → evict tail.prev (and delete from map);
                         create node, map.set, pushFront } }
```

Explaining every part:

| Part | Purpose |
|---|---|
| `Map<key, Node>` | O(1) lookup from key to its node in the list |
| Doubly linked list | Keeps recency order. `head.next` = most recent, `tail.prev` = least recent |
| `prev` **and** `next` pointers | Lets us unlink a node in O(1) *without searching* for its predecessor |
| Sentinel `head`/`tail` | No null checks when the list is empty or has one node |
| `key` stored inside each node | On eviction we know which map entry to delete, in O(1) |
| `get` moves node to front | Reading counts as "use" |
| `put` on existing key | Update value **and** refresh recency; no eviction (size doesn't grow) |

## b) Data structures and O(1) reasoning

- `get`: one hash lookup + two pointer rewires (unlink, push front) → **O(1)**
- `put`: one hash lookup/insert + at most one eviction (tail pointer + hash delete) → **O(1)**

**What if we used a plain array?**
| Operation | Cost |
|---|---|
| Find by key | O(n) scan |
| Move to front (`splice`) | O(n) shifting |
| Evict oldest (`shift`) | O(n) reindex |

**What if we used a plain object?** Lookup is O(1), but an object has **no recency order** (and integer-like keys are re-sorted numerically), so finding the LRU key requires scanning all keys: O(n) per eviction.

At 100k entries under load, this is the difference between microseconds and milliseconds per call. The test suite includes a 300k-operation sanity check completing in well under a second.

## c) Scaling across multiple Node.js instances

An in-process LRU is **per instance**: each server has its own hit rate and its own stale data. Options:

### 1. Redis as shared cache (recommended default)
Configure `maxmemory` + `maxmemory-policy allkeys-lru` (Redis uses *approximate* LRU by sampling, which works well in practice) and use **cache-aside**: check Redis → on miss load from DB → `SET … EX ttl`. Implemented in `RedisCache.js` with TTL jitter, single-flight, and fail-open behaviour.

### 2. Two-tier cache (L1 in-process LRU + L2 Redis)
Hot keys served from local memory (~ns); Redis pub/sub broadcasts invalidations so other instances drop stale L1 entries. Fastest, but adds invalidation complexity and a small staleness window. Implemented in `TwoTierCache.js`; the test proves an invalidation on instance A evicts the entry on instance B.

### 3. DynamoDB
Managed, durable, TTL support, single-digit-ms latency (µs with DAX). But **no native LRU eviction**, and it is billed per request. Better for durable/session-style data than for a hot cache.

### Trade-offs

| Concern | In-process LRU | Redis | DynamoDB |
|---|---|---|---|
| Latency | ~ns | ~0.5–2 ms network hop | ~5–10 ms (DAX: µs) |
| Cross-server consistency | None | Strong per key on primary; replicas async | Eventual by default; strong reads optional |
| Eviction | Exact LRU | Approximate LRU/LFU, configurable | TTL only |
| Ops complexity | None | Cluster, failover, memory sizing | Low ops; watch cost |

### Design points to mention
- **Consistency:** the cache is eventually consistent with the DB. Use short TTLs; **invalidate on write by deleting the key** (don't update it: avoids write races); don't cache data that must be exact (e.g. live inventory).
- **Cache stampede:** many misses on one hot key → DB overload. Mitigate with single-flight/request coalescing, `SET NX` locks, TTL jitter.
- **Failure mode:** if Redis is down, fall back to the DB behind a circuit breaker; a cache outage must not become an app outage.
- **Hot keys and serialization:** replicate hot keys or serve them from L1; watch JSON serialization cost.
- **Scaling Redis:** shard via Redis Cluster hash slots; replicas for read scaling and failover.
- **Sticky sessions** at the load balancer keep per-instance caches useful without sharing, but hurt load distribution and don't survive restarts.

**Recommendation:** Redis with cache-aside and TTLs first; add an L1 LRU only if profiling shows the network hop matters. Operational complexity is the real cost of distributed caching, so start simple.
