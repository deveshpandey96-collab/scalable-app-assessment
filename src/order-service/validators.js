import { ValidationError } from "./errors.js";

const MAX_LINES = 100;
const MAX_QTY = 1000;

/**
 * Validates and normalises cart items.
 * - non-empty array, bounded size
 * - integer qty in [1, MAX_QTY]  (rejects negative, fractional, NaN)
 * - duplicate productIds are merged
 */
export function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }
  if (items.length > MAX_LINES) {
    throw new ValidationError(`too many line items (max ${MAX_LINES})`);
  }
  const merged = new Map();
  for (const item of items) {
    const { productId, qty } = item ?? {};
    const idOk = (typeof productId === "string" && productId.length > 0) || Number.isInteger(productId);
    if (!idOk) throw new ValidationError("invalid productId");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new ValidationError(`qty must be an integer between 1 and ${MAX_QTY}`);
    }
    merged.set(productId, (merged.get(productId) ?? 0) + qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}
