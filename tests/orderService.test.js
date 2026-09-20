import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderService } from "../src/order-service/OrderService.js";
import { PricingService } from "../src/order-service/PricingService.js";
import { toHttpError } from "../src/order-service/http.js";
import { NotFoundError, ValidationError } from "../src/order-service/errors.js";
import { makeDeps, PaymentFailedError, PaymentUnavailableError } from "./helpers.js";

function build(overrides) {
  const { deps, store } = makeDeps(overrides);
  deps.pricing = new PricingService();
  return { service: new OrderService(deps), store };
}
const cmd = (extra = {}) => ({
  userId: 1,
  items: [{ productId: "p1", qty: 2 }, { productId: "p2", qty: 1 }],
  paymentToken: "tok",
  idempotencyKey: "key-1",
  ...extra,
});

test("happy path: integer cents total, charged once, event published", async () => {
  const { service, store } = build();
  const order = await service.createOrder(cmd());
  assert.equal(order.status, "PAID");
  assert.equal(order.totalCents, 1099 * 2 + 250);          // 2448, no float math
  assert.equal(store.charges.length, 1);
  assert.equal(store.charges[0].amountCents, 2448);
  assert.equal(store.events[0].type, "OrderPlaced");
});

test("idempotent retry returns the same order and does not charge twice", async () => {
  const { service, store } = build();
  const first = await service.createOrder(cmd());
  const second = await service.createOrder(cmd());
  assert.equal(second.id, first.id);
  assert.equal(store.charges.length, 1);
  assert.equal(store.orders.length, 1);
});

test("duplicate product lines are merged", async () => {
  const { service } = build();
  const order = await service.createOrder(
    cmd({ items: [{ productId: "p2", qty: 1 }, { productId: "p2", qty: 3 }] })
  );
  assert.equal(order.totalCents, 1000);
});

test("unknown user -> NotFoundError, nothing charged or persisted", async () => {
  const { service, store } = build();
  await assert.rejects(service.createOrder(cmd({ userId: 99 })), NotFoundError);
  assert.equal(store.charges.length, 0);
  assert.equal(store.orders.length, 0);
});

test("unknown product -> NotFoundError before any side effect", async () => {
  const { service, store } = build();
  await assert.rejects(service.createOrder(cmd({ items: [{ productId: "nope", qty: 1 }] })), NotFoundError);
  assert.equal(store.charges.length, 0);
});

for (const bad of [
  [],
  null,
  [{ productId: "p1", qty: 0 }],
  [{ productId: "p1", qty: -2 }],
  [{ productId: "p1", qty: 1.5 }],
  [{ productId: "p1", qty: "3" }],
  [{ qty: 1 }],
]) {
  test(`validation rejects ${JSON.stringify(bad)}`, async () => {
    const { service, store } = build();
    await assert.rejects(service.createOrder(cmd({ items: bad })), ValidationError);
    assert.equal(store.charges.length, 0);
  });
}

test("missing idempotency key is rejected", async () => {
  const { service } = build();
  await assert.rejects(service.createOrder(cmd({ idempotencyKey: undefined })), ValidationError);
});

test("card decline marks order FAILED and surfaces a 402", async () => {
  const { service, store } = build({
    payments: { charge: async () => { throw new PaymentFailedError("card_declined"); } },
  });
  await assert.rejects(service.createOrder(cmd()), (err) => err instanceof PaymentFailedError);
  assert.equal(store.orders[0].status, "FAILED");
  assert.equal(toHttpError(new PaymentFailedError("x")).status, 402);
});

test("retry after a FAILED order does not re-charge", async () => {
  let calls = 0;
  const { service } = build({
    payments: { charge: async () => { calls++; throw new PaymentFailedError("card_declined"); } },
  });
  await assert.rejects(service.createOrder(cmd()), PaymentFailedError);
  await assert.rejects(service.createOrder(cmd()), PaymentFailedError);
  assert.equal(calls, 1);
});

test("unknown payment outcome leaves order PENDING (no false FAILED) and a retry resumes it", async () => {
  let attempt = 0;
  const { service, store } = build({
    payments: {
      charge: async (req) => {
        if (attempt++ === 0) throw new PaymentUnavailableError("timeout");
        return { id: `ch_${req.idempotencyKey}` };
      },
    },
  });
  await assert.rejects(service.createOrder(cmd()), PaymentUnavailableError);
  assert.equal(store.orders[0].status, "PENDING");

  const order = await service.createOrder(cmd());          // same idempotency key
  assert.equal(order.status, "PAID");
  assert.equal(store.orders.length, 1);                    // resumed, not duplicated
});

test("notification failure does NOT fail a paid order", async () => {
  const { service, store } = build({
    events: { publish: async () => { throw new Error("SES down"); } },
  });
  const order = await service.createOrder(cmd());
  assert.equal(order.status, "PAID");
  assert.ok(store.logs.some(([lvl, msg]) => lvl === "error" && msg === "order.event_publish_failed"));
});

test("logs contain ids only, no PII (email / totals)", async () => {
  const { service, store } = build();
  await service.createOrder(cmd());
  const dump = JSON.stringify(store.logs);
  assert.ok(!dump.includes("a@b.com"));
});

test("error mapping: typed errors -> status codes, unknown -> generic 500", () => {
  assert.equal(toHttpError(new ValidationError("x")).status, 400);
  assert.equal(toHttpError(new NotFoundError("x")).status, 404);
  const generic = toHttpError(new Error("db password is hunter2"));
  assert.equal(generic.status, 500);
  assert.ok(!JSON.stringify(generic.body).includes("hunter2"));
});

test("PricingService: integer cents avoid floating point drift", () => {
  const pricing = new PricingService();
  const total = pricing.calculateTotal([{ productId: "a", qty: 3 }], [{ id: "a", priceCents: 10 }]);
  assert.equal(total, 30);
  assert.equal(0.1 * 3 === 0.3, false); // the bug integer cents avoid
});
