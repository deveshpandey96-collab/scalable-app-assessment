import {
  NotFoundError,
  PaymentFailedError,
  PaymentUnavailableError,
  ValidationError,
} from "./errors.js";
import { validateItems } from "./validators.js";

/**
 * Orchestration only. Every collaborator is injected (Dependency Inversion),
 * so the service is unit-testable with in-memory fakes and has no idea
 * whether it talks to Postgres, Stripe, SES or a queue.
 *
 * Flow:  validate -> price -> persist PENDING -> charge (idempotent)
 *        -> mark PAID -> publish event (best effort, never fails the order)
 */
export class OrderService {
  constructor({ users, products, orders, pricing, payments, events, logger, currency = "usd" }) {
    this.users = users;
    this.products = products;
    this.orders = orders;
    this.pricing = pricing;
    this.payments = payments;
    this.events = events;
    this.logger = logger;
    this.currency = currency;
  }

  /**
   * @param {object} cmd
   * @param {string|number} cmd.userId   from the authenticated session, NOT the request body
   * @param {Array<{productId, qty}>} cmd.items
   * @param {string} cmd.paymentToken
   * @param {string} cmd.idempotencyKey  client-generated; makes retries/double-clicks safe
   */
  async createOrder({ userId, items, paymentToken, idempotencyKey }) {
    if (!idempotencyKey) throw new ValidationError("idempotencyKey is required");

    // 0. Idempotency: a retry resumes or returns the earlier result.
    let order = await this.orders.findByIdempotencyKey(userId, idempotencyKey);
    if (order?.status === "PAID") return order;
    if (order?.status === "FAILED") throw new PaymentFailedError(order.failureCode);

    if (!order) {
      // 1. Validate + price (no side effects yet)
      const lines = validateItems(items);
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError("user");
      const products = await this.products.findByIds(lines.map((l) => l.productId)); // 1 query, not N
      const totalCents = this.pricing.calculateTotal(lines, products);

      // 2. Persist intent BEFORE charging: we never take money without a record.
      //    Repository reserves stock atomically in the same transaction.
      order = await this.orders.create({
        userId,
        items: lines,
        totalCents,
        status: "PENDING",
        idempotencyKey,
      });
    }

    // 3. Charge. Stripe idempotency key = order id, so retrying can't double-charge.
    let charge;
    try {
      charge = await this.payments.charge({
        amountCents: order.totalCents,
        currency: this.currency,
        token: paymentToken,
        idempotencyKey: `order-${order.id}`,
      });
    } catch (err) {
      if (err instanceof PaymentUnavailableError) {
        // Outcome unknown: leave PENDING; retry or webhook reconciles it.
        this.logger.warn("order.payment_unknown", { orderId: order.id });
        throw err;
      }
      const reason = err.reason ?? "payment_failed";
      await this.orders.markFailed(order.id, reason); // also releases reserved stock
      this.logger.info("order.payment_failed", { orderId: order.id, reason });
      throw err instanceof PaymentFailedError ? err : new PaymentFailedError(reason);
    }

    // 4. Record success.
    const paid = await this.orders.markPaid(order.id, charge.id);

    // 5. Side effects are decoupled. A broken email provider must not fail a paid order.
    try {
      await this.events.publish("OrderPlaced", { orderId: paid.id, userId });
    } catch (err) {
      this.logger.error("order.event_publish_failed", { orderId: paid.id, error: err.message });
    }

    this.logger.info("order.created", { orderId: paid.id }); // ids only, no PII
    return paid;
  }
}
