import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisCache } from "../src/distributed-cache/RedisCache.js";
import { TwoTierCache } from "../src/distributed-cache/TwoTierCache.js";

// Minimal fake Redis with pub/sub, shared by "instances" in a test.
function makeFakeRedis() {
  const data = new Map();
  const subs = [];
  const client = () => {
    const handlers = [];
    return {
      get: async (k) => (data.has(k) ? data.get(k) : null),
      set: async (k, v) => void data.set(k, v),
      del: async (k) => void data.delete(k),
      subscribe: async () => void subs.push(handlers),
      on: (_evt, fn) => handlers.push(fn),
      publish: async (ch, msg) => subs.forEach((hs) => hs.forEach((fn) => fn(ch, msg))),
    };
  };
  return { client, data };
}

test("RedisCache.getOrLoad: miss loads once, then hits", async () => {
  const { client } = makeFakeRedis();
  const cache = new RedisCache({ redis: client() });
  let loads = 0;
  const loader = async () => (loads++, { id: 1 });
  assert.deepEqual(await cache.getOrLoad("u:1", loader), { id: 1 });
  assert.deepEqual(await cache.getOrLoad("u:1", loader), { id: 1 });
  assert.equal(loads, 1);
});

test("RedisCache: concurrent misses are coalesced (stampede protection)", async () => {
  const { client } = makeFakeRedis();
  const cache = new RedisCache({ redis: client() });
  let loads = 0;
  const loader = async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return "v"; };
  const results = await Promise.all(Array.from({ length: 50 }, () => cache.getOrLoad("hot", loader)));
  assert.ok(results.every((r) => r === "v"));
  assert.equal(loads, 1);
});

test("RedisCache: fails open when Redis is down", async () => {
  const broken = {
    get: async () => { throw new Error("ECONNREFUSED"); },
    set: async () => { throw new Error("ECONNREFUSED"); },
    del: async () => { throw new Error("ECONNREFUSED"); },
  };
  const cache = new RedisCache({ redis: broken, logger: {} });
  assert.equal(await cache.getOrLoad("k", async () => "from-db"), "from-db");
});

test("RedisCache: TTL jitter stays within bounds", () => {
  const cache = new RedisCache({ redis: {}, ttlSeconds: 100, jitterRatio: 0.1 });
  for (let i = 0; i < 500; i++) {
    const ttl = cache._ttl();
    assert.ok(ttl >= 90 && ttl <= 110, `ttl ${ttl}`);
  }
});

test("TwoTierCache: invalidation on instance A evicts L1 on instance B", async () => {
  const shared = makeFakeRedis();
  const mk = async (id) => {
    const l2 = new RedisCache({ redis: shared.client() });
    const t = new TwoTierCache({
      l2, instanceId: id, publisher: shared.client(), subscriber: shared.client(),
    });
    await t.init();
    return t;
  };
  const [a, b] = [await mk("A"), await mk("B")];
  let db = "v1";
  const loader = async () => db;

  assert.equal(await a.get("k", loader), "v1");
  assert.equal(await b.get("k", loader), "v1");    // B has "v1" in its L1
  db = "v2";
  await a.invalidate("k");                          // write happened on A
  assert.equal(await b.get("k", loader), "v2");     // B's L1 was dropped -> reloads fresh
});
