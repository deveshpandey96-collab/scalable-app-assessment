// Parameterised queries ONLY ($1, $2 ...). Never interpolate values into SQL.
// `db` is a node-postgres Pool (or anything with query(text, params) -> { rows }).

export class PgUserRepository {
  constructor(db) { this.db = db; }
  async findById(id) {
    const { rows } = await this.db.query("SELECT id, email FROM users WHERE id = $1", [id]);
    return rows[0] ?? null;
  }
}

export class PgProductRepository {
  constructor(db) { this.db = db; }
  async findByIds(ids) {
    const { rows } = await this.db.query(
      "SELECT id, price_cents AS \"priceCents\" FROM products WHERE id = ANY($1)",
      [ids]
    );
    return rows;
  }
}

export class PgOrderRepository {
  constructor(db) { this.db = db; }

  async findByIdempotencyKey(userId, key) {
    const { rows } = await this.db.query(
      `SELECT id, user_id AS "userId", total_cents AS "totalCents", status, failure_code AS "failureCode"
         FROM orders WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key]
    );
    return rows[0] ?? null;
  }

  // Runs in ONE transaction: insert order + items and atomically reserve stock
  //   UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty
  // (0 rows updated => out of stock => rollback). UNIQUE(user_id, idempotency_key)
  // makes concurrent duplicates fail safely.
  async create({ userId, items, totalCents, status, idempotencyKey }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO orders (user_id, total_cents, status, idempotency_key)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id AS "userId", total_cents AS "totalCents", status`,
        [userId, totalCents, status, idempotencyKey]
      );
      const order = rows[0];
      for (const { productId, qty } of items) {
        const res = await client.query(
          "UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2",
          [productId, qty]
        );
        if (res.rowCount === 0) throw Object.assign(new Error("out of stock"), { status: 409 });
        await client.query(
          "INSERT INTO order_items (order_id, product_id, qty) VALUES ($1, $2, $3)",
          [order.id, productId, qty]
        );
      }
      await client.query("COMMIT");
      return order;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async markPaid(orderId, chargeId) {
    const { rows } = await this.db.query(
      `UPDATE orders SET status = 'PAID', charge_id = $2 WHERE id = $1
       RETURNING id, user_id AS "userId", total_cents AS "totalCents", status`,
      [orderId, chargeId]
    );
    return rows[0];
  }

  async markFailed(orderId, failureCode) {
    await this.db.query(
      "UPDATE orders SET status = 'FAILED', failure_code = $2 WHERE id = $1",
      [orderId, failureCode]
    );
    // + release reserved stock (same statement/transaction in a real implementation)
  }
}

// Transactional outbox: publish() inserts a row that a worker relays to the queue,
// giving at-least-once delivery without coupling the request to the email provider.
export class OutboxEventPublisher {
  constructor(db) { this.db = db; }
  async publish(type, payload) {
    await this.db.query("INSERT INTO outbox (type, payload) VALUES ($1, $2)", [type, JSON.stringify(payload)]);
  }
}
