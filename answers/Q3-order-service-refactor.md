# Q3. Refactor for Design: `OrderService`

Reference implementation: [`src/order-service/`](../src/order-service/), verified by [`tests/orderService.test.js`](../tests/orderService.test.js).

## a) Design problems in the original

### Security
| # | Problem | Impact | Fix |
|---|---|---|---|
| 1 | **SQL injection.** Values are interpolated into query strings (`WHERE id = ${userId}`). | Full database compromise. The most serious issue. | Parameterised queries (`$1`) |
| 2 | **`userId` is a caller-supplied argument.** | A client can order on behalf of anyone. | Take it from the authenticated session (`req.user.id`) |
| 3 | **PII in logs and email bodies** (raw user id, totals in `console.log`). | Privacy/compliance exposure, log leakage. | Structured logger, IDs only |

### Correctness
| # | Problem | Fix |
|---|---|---|
| 4 | **Floating-point money.** `total * 100` can yield `1099.9999…`. | Integer cents everywhere |
| 5 | **Wrong result handling.** Drivers return arrays/result objects, so `!user` is never true and `product.price` may be `undefined`. Missing product → `NaN` total. | Explicit `findById` returning `null`; typed `NotFoundError` |
| 6 | **No input validation.** Empty cart, negative/fractional/huge `qty`, duplicate lines all pass. | `validateItems()` |
| 7 | **Wrong Stripe usage.** Legacy `charges` API; `paymentResult.success` is not a real field; declines *throw* rather than return; no currency; no idempotency key. | `PaymentIntents`, check `status === "succeeded"`, catch decline errors, pass currency + idempotency key |
| 8 | **`INSERT` doesn't return the row**, so `order.id` is undefined. | `RETURNING id` |
| 9 | **No stock check**, so overselling is possible. | Atomic `UPDATE … WHERE stock >= qty` in the order transaction |

### Reliability and error handling
| # | Problem | Fix |
|---|---|---|
| 10 | **No transaction / compensation.** Charge succeeds, insert fails → customer charged, no order. | Persist `PENDING` order *first*, charge second, mark `PAID` third; webhook reconciliation |
| 11 | **Email failure fails a paid order.** The caller sees an exception, retries, and gets double-charged. | Decouple side effects (outbox/queue); never fail the order on notification errors |
| 12 | **Generic `Error("…")`.** Caller can't distinguish validation vs decline vs outage. | Typed errors → 400 / 404 / 402 / 503 |
| 13 | **No idempotency.** Retries and double-clicks duplicate charges. | Idempotency key + `UNIQUE(user_id, idempotency_key)` |
| 14 | **Unknown payment outcome** (timeout) is treated the same as a decline. | `PaymentUnavailableError` leaves order `PENDING`; retry resumes safely |

### Performance
| # | Problem | Fix |
|---|---|---|
| 15 | **N+1 queries.** One sequential `SELECT` per item. | One query: `WHERE id = ANY($1)` |

### Design (SOLID)
| Principle | Violation |
|---|---|
| **SRP** | One method validates, prices, charges, persists, emails, and logs, so it has six reasons to change |
| **DIP** | Hard-wired to globals `db`, `stripe`, `emailService`, `console`; impossible to unit test without patching globals |
| **OCP** | Adding PayPal or SMS means editing `createOrder` |
| **ISP** | Callers depend on the *entire* Stripe SDK surface when they need one `charge` operation |

## b) Redesign

```
HTTP layer  ─ OrderController / createOrderHandler
              auth, parsing, Idempotency-Key header, error → status mapping
                 │
Application ─ OrderService                      (orchestration only)
                 │   depends on abstractions ↓
                 ├── UserRepository        findById(id)
                 ├── ProductRepository     findByIds(ids[])          ← 1 query
                 ├── PricingService        calculateTotal() → cents  ← pure, no I/O
                 ├── OrderRepository       findByIdempotencyKey / create / markPaid / markFailed
                 ├── PaymentGateway        charge({amountCents, currency, token, idempotencyKey})
                 │       └── StripePaymentGateway  (adapter)
                 ├── EventPublisher        publish("OrderPlaced", …)
                 │       └── OutboxEventPublisher → worker → queue → Email / Analytics handlers
                 └── Logger                structured, no PII
```

### Flow of `createOrder`

1. Require an idempotency key; if an order already exists for it, return / resume it.
2. Validate items (integers, bounds, merge duplicates).
3. Load user and products (one query); compute total in **integer cents**.
4. Persist order as `PENDING` and reserve stock in one DB transaction.
5. Charge via `PaymentGateway` with idempotency key `order-<id>`.
   - Decline → mark `FAILED`, release stock, throw `PaymentFailedError` (402).
   - Unknown outcome → leave `PENDING`, throw `PaymentUnavailableError` (503); a retry or a Stripe webhook settles it.
6. Mark `PAID`.
7. Publish `OrderPlaced` best-effort; failures are logged and **never** fail the order.

### Supporting pieces

- **Transactional outbox:** `publish()` inserts into an `outbox` table; a worker relays to the queue → at-least-once email delivery without coupling to the request.
- **Webhook reconciliation:** handles "charge succeeded, process crashed before `markPaid`".
- **Composition root** (`compose.example.js`): the single place concrete classes are wired.

## c) SOLID principles addressed, and why they matter to a fast-shipping team

| Principle | How the redesign applies it | Payoff for a team shipping fast |
|---|---|---|
| **S**ingle Responsibility | Validation, pricing, payment, persistence, and notification each live in their own unit | A pricing change touches `PricingService` only; smaller diffs, fewer merge conflicts |
| **O**pen/Closed | New payment provider / notification channel = new class, not an edit to `createOrder` | New features don't risk regressions in the money path |
| **L**iskov Substitution | Any `PaymentGateway` must honour the same contract (same errors, same idempotency) | Swapping providers or test fakes is safe |
| **I**nterface Segregation | `PaymentGateway.charge` instead of the whole Stripe SDK | Small mocks, easy to understand |
| **D**ependency Inversion | `OrderService` receives collaborators via its constructor | Tests run in **~ms with in-memory fakes** (see `tests/`), so CI is fast and reliable |

**The bottom line:** speed comes from making change *safe*. Small isolated units, fast deterministic tests, and clear contracts let many developers change the system in parallel, onboard quickly, and deploy often without fear. Skipping structure only feels faster until the first production incident.
