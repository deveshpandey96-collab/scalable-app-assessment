import { test } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../src/lru-cache/LRUCache.js";
import { MapLRUCache } from "../src/lru-cache/MapLRUCache.js";

for (const [name, Impl] of [["LinkedList LRU", LRUCache], ["Map LRU", MapLRUCache]]) {
  test(`${name}: basic get/put`, () => {
    const c = new Impl(2);
    c.put("a", 1);
    assert.equal(c.get("a"), 1);
    assert.equal(c.get("missing"), undefined);
  });

  test(`${name}: evicts least recently used`, () => {
    const c = new Impl(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("c", 3);                       // evicts a
    assert.equal(c.get("a"), undefined);
    assert.equal(c.get("b"), 2);
    assert.equal(c.get("c"), 3);
  });

  test(`${name}: get refreshes recency`, () => {
    const c = new Impl(2);
    c.put("a", 1);
    c.put("b", 2);
    c.get("a");                          // a is now most recent
    c.put("c", 3);                       // evicts b, not a
    assert.equal(c.get("b"), undefined);
    assert.equal(c.get("a"), 1);
  });

  test(`${name}: put on existing key updates value and recency, no eviction`, () => {
    const c = new Impl(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("a", 10);
    assert.equal(c.size, 2);
    c.put("c", 3);                       // evicts b
    assert.equal(c.get("a"), 10);
    assert.equal(c.get("b"), undefined);
  });

  test(`${name}: capacity 1`, () => {
    const c = new Impl(1);
    c.put("a", 1);
    c.put("b", 2);
    assert.equal(c.get("a"), undefined);
    assert.equal(c.get("b"), 2);
  });

  test(`${name}: rejects invalid capacity`, () => {
    assert.throws(() => new Impl(0), RangeError);
    assert.throws(() => new Impl(-1), RangeError);
    assert.throws(() => new Impl(1.5), RangeError);
  });

  test(`${name}: stores falsy values correctly`, () => {
    const c = new Impl(2);
    c.put("zero", 0);
    c.put("empty", "");
    assert.equal(c.get("zero"), 0);
    assert.equal(c.get("empty"), "");
  });
}

test("both implementations behave identically under random operations", () => {
  const a = new LRUCache(50);
  const b = new MapLRUCache(50);
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let i = 0; i < 20000; i++) {
    const key = `k${rnd(120)}`;
    if (rnd(2) === 0) {
      a.put(key, i);
      b.put(key, i);
    } else {
      assert.equal(a.get(key), b.get(key), `mismatch at op ${i} for ${key}`);
    }
  }
  assert.equal(a.size, b.size);
});

test("operations stay fast at scale (O(1) sanity check)", () => {
  const c = new LRUCache(100_000);
  const t = performance.now();
  for (let i = 0; i < 300_000; i++) c.put(i, i);
  for (let i = 200_000; i < 300_000; i++) c.get(i);
  const ms = performance.now() - t;
  assert.ok(c.size === 100_000);
  assert.ok(ms < 2000, `took ${ms}ms, expected well under 2s`);
});
