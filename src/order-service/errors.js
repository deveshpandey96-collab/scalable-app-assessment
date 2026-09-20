// Typed errors let the HTTP layer map failures to correct status codes
// without string-matching on messages.
export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", status = 500 } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, { code: "VALIDATION_ERROR", status: 400 });
  }
}

export class NotFoundError extends AppError {
  constructor(what) {
    super(`${what} not found`, { code: "NOT_FOUND", status: 404 });
  }
}

// The card was declined / payment definitively failed.
export class PaymentFailedError extends AppError {
  constructor(reason = "payment_failed") {
    super("Payment failed", { code: `PAYMENT_${String(reason).toUpperCase()}`, status: 402 });
    this.reason = reason;
  }
}

// We do NOT know whether the charge happened (timeout, network, 5xx).
// The order stays PENDING and is settled by retry (idempotent) or webhook.
export class PaymentUnavailableError extends AppError {
  constructor(message = "Payment provider unavailable") {
    super(message, { code: "PAYMENT_UNAVAILABLE", status: 503 });
  }
}
