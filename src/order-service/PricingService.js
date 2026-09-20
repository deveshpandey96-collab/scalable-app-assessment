import { NotFoundError } from "./errors.js";

/**
 * Pure logic, no I/O. Money is ALWAYS integer minor units (cents):
 * floating point (0.1 + 0.2) must never touch money.
 * Future discounts/tax/shipping rules live here (Open/Closed).
 */
export class PricingService {
  calculateTotal(items, products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    let totalCents = 0;
    for (const { productId, qty } of items) {
      const product = byId.get(productId);
      if (!product) throw new NotFoundError(`product ${productId}`);
      if (!Number.isInteger(product.priceCents) || product.priceCents < 0) {
        throw new Error(`product ${productId} has invalid price`);
      }
      totalCents += product.priceCents * qty;
    }
    return totalCents;
  }
}
