# Q2. A Real Bug You Debugged

> **Use a bug from your own experience.** Interviewers detect invented stories quickly through follow-up questions (*"what did the logs show?", "what did you rule out first?"*). Below is a structure that makes a real story land, plus a worked example of the depth expected.

## Structure: Symptom → Hypotheses → Investigation → Root Cause → Fix → Prevention

| Section | What to write | What makes it credible |
|---|---|---|
| **Context** | 1 sentence: system, scale, your role | Real numbers (users, RPS, data size) |
| **Symptom** | What users/monitoring observed | Frequency, timing, who was affected |
| **Hypotheses** | 2–3 things you suspected first | Include the **wrong** ones you ruled out and how |
| **Investigation** | Tools and steps | Logs + correlation IDs, metrics, `EXPLAIN ANALYZE`, profiler, heap snapshots, packet capture, bisecting deploys |
| **Root cause** | The actual mechanism | Explain *why* it only happened sometimes |
| **Fix** | What you changed | Smallest safe change first, then the durable one |
| **Prevention** | What stops recurrence | Regression test, alert, runbook, design change |

## Worked example (illustrative only)

**Context:** Node/Express order API, ~40 req/s at peak, Postgres, deployed on 4 instances.

**Symptom:** About 1 in 500 orders was duplicated, and customers were charged twice. It happened only at peak and only for mobile clients.

**Hypotheses:**
1. *Double-click on the button* → ruled out: the web client disables the button, and mobile duplicates arrived 3–8 s apart, not milliseconds.
2. *Two instances processing one queue message* → ruled out: there was no queue in this path.
3. *Client retry after timeout* → matched the 3–8 s gap.

**Investigation:** I added a request ID at the load balancer and propagated it through the logs. Filtering duplicate orders showed two distinct request IDs with the same cart and user. The first request's log ended at "charge started" with no response logged; the mobile client's timeout was 5 s, and Stripe's p99 that day was 6 s. So the client timed out and retried while the first request was still completing in the background.

**Root cause:** No idempotency. The server treated the retry as a new order, while the first request also completed successfully after the client had already given up.

**Fix:**
- Immediate: raised the client timeout above the provider p99 and returned `202` with an order ID for slow paths.
- Durable: added a client-generated `Idempotency-Key` header, a `UNIQUE(user_id, idempotency_key)` constraint, and passed the order ID as Stripe's idempotency key.

**Prevention:** Integration test that fires the same request twice concurrently and asserts one order and one charge; alert on unique-constraint violations; runbook for reconciling duplicates. *(This is the same pattern implemented in `src/order-service/OrderService.js`.)*

