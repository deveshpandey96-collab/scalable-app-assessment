class Node {
  constructor(key, value) {
    this.key = key;      // stored so eviction can delete from the map in O(1)
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

/**
 * LRU cache with O(1) get/put.
 *   Map (hash table)     : key -> Node          => O(1) lookup
 *   Doubly linked list   : recency order        => O(1) unlink + O(1) insert at head
 *   head.next = most recently used, tail.prev = least recently used.
 * Sentinel head/tail nodes remove all null/edge-case branches.
 */
export class LRUCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.map = new Map();
    this.head = new Node();
    this.tail = new Node();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size() {
    return this.map.size;
  }

  _unlink(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _pushFront(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  get(key) {
    const node = this.map.get(key);
    if (node === undefined) return undefined;
    this._unlink(node);        // touching a key makes it most recently used
    this._pushFront(node);
    return node.value;
  }

  put(key, value) {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      existing.value = value;
      this._unlink(existing);
      this._pushFront(existing);
      return;
    }
    if (this.map.size >= this.capacity) {
      const lru = this.tail.prev;   // evict least recently used
      this._unlink(lru);
      this.map.delete(lru.key);
    }
    const node = new Node(key, value);
    this.map.set(key, node);
    this._pushFront(node);
  }

  delete(key) {
    const node = this.map.get(key);
    if (node === undefined) return false;
    this._unlink(node);
    return this.map.delete(key);
  }

  has(key) {
    return this.map.has(key);   // does not affect recency
  }
}
