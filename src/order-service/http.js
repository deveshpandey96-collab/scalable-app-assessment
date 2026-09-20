import { AppError } from "./errors.js";

/** Maps typed errors to HTTP responses. Unknown errors never leak details. */
export function toHttpError(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: err.code, message: err.message } };
  }
  return { status: 500, body: { error: "INTERNAL_ERROR", message: "Something went wrong" } };
}

/**
 * Express handler factory. The HTTP layer owns: auth, parsing, status codes.
 * userId comes from the authenticated session (req.user), never from the body.
 */
export function createOrderHandler({ orderService, logger }) {
  return async function createOrder(req, res) {
    try {
      const order = await orderService.createOrder({
        userId: req.user.id,
        items: req.body?.items,
        paymentToken: req.body?.paymentToken,
        idempotencyKey: req.get("Idempotency-Key"),
      });
      res.status(201).json({ id: order.id, status: order.status, totalCents: order.totalCents });
    } catch (err) {
      const { status, body } = toHttpError(err);
      if (status >= 500) logger.error("order.unhandled", { error: err.message });
      res.status(status).json(body);
    }
  };
}
