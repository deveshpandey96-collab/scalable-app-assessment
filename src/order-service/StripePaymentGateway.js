import { PaymentFailedError, PaymentUnavailableError } from "./errors.js";

/**
 * Adapter over the Stripe SDK. Implements the implicit PaymentGateway interface:
 *   charge({ amountCents, currency, token, idempotencyKey }) -> { id }
 * Throws PaymentFailedError (definitive decline) or PaymentUnavailableError (unknown outcome).
 * Uses PaymentIntents (the legacy `charges` API is deprecated).
 */
export class StripePaymentGateway {
  constructor({ stripe }) {
    this.stripe = stripe;
  }

  async charge({ amountCents, currency, token, idempotencyKey }) {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          payment_method: token,
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        },
        { idempotencyKey }
      );
      if (intent.status !== "succeeded") throw new PaymentFailedError(intent.status);
      return { id: intent.id };
    } catch (err) {
      if (err instanceof PaymentFailedError) throw err;
      if (err?.type === "StripeCardError") throw new PaymentFailedError(err.code);
      throw new PaymentUnavailableError(err?.message);
    }
  }
}
