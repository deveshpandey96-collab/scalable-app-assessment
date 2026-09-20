// In-memory fakes: possible only because OrderService depends on abstractions (DIP).
import { PaymentFailedError, PaymentUnavailableError } from "../src/order-service/errors.js";

export function makeDeps(overrides = {}) {
  const store = { orders: [], events: [], charges: [], logs: [] };
  let nextId = 1;

  const deps = {
    users: { findById: async (id) => (id === 1 ? { id: 1, email: "a@b.com" } : null) },
    products: {
      findByIds: async (ids) =>
        [{ id: "p1", priceCents: 1099 }, { id: "p2", priceCents: 250 }].filter((p) => ids.includes(p.id)),
    },
    orders: {
      findByIdempotencyKey: async (userId, key) =>
        store.orders.find((o) => o.userId === userId && o.idempotencyKey === key) ?? null,
      create: async (data) => {
        const o = { id: nextId++, ...data };
        store.orders.push(o);
        return { ...o };
      },
      markPaid: async (id, chargeId) => {
        const o = store.orders.find((x) => x.id === id);
        Object.assign(o, { status: "PAID", chargeId });
        return { ...o };
      },
      markFailed: async (id, code) => {
        Object.assign(store.orders.find((x) => x.id === id), { status: "FAILED", failureCode: code });
      },
    },
    pricing: null, // set below
    payments: {
      charge: async (req) => {
        store.charges.push(req);
        return { id: `ch_${req.idempotencyKey}` };
      },
    },
    events: { publish: async (type, payload) => void store.events.push({ type, payload }) },
    logger: {
      info: (m, x) => store.logs.push(["info", m, x]),
      warn: (m, x) => store.logs.push(["warn", m, x]),
      error: (m, x) => store.logs.push(["error", m, x]),
    },
    ...overrides,
  };
  return { deps, store };
}

export { PaymentFailedError, PaymentUnavailableError };
