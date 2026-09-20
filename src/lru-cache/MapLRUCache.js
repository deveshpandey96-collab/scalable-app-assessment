/**
 * Compact alternative: a JS Map iterates in insertion order, so
 * delete + re-insert moves a key to "most recent", and the first key is the LRU.
 * Same O(1) behaviour, ~10 lines. The linked-list version above makes the mechanism explicit.
 */
export class MapLRUCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.m = new Map();
  }

  get size() {
    return this.m.size;
  }

  get(key) {
    if (!this.m.has(key)) return undefined;
    const value = this.m.get(key);
    this.m.delete(key);
    this.m.set(key, value);
    return value;
  }

  put(key, value) {
    this.m.delete(key);
    this.m.set(key, value);
    if (this.m.size > this.capacity) {
      this.m.delete(this.m.keys().next().value);
    }
  }

  delete(key) {
    return this.m.delete(key);
  }
}
