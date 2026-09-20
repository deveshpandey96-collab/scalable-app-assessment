# Scalable Application Assessment

Answers, working reference code, tests, and an architecture overview for a Node.js/Express assessment covering **secure service design**, **SOLID refactoring**, **an O(1) LRU cache**, and **scaling a cache across multiple instances**.

> **Note on Q1 and Q2:** these ask for *your* real project and *your* real bug, so they are provided as structured templates with a worked example, not invented stories. Fill them in with your own experience before submitting.

## Contents

```
scalable-app-assessment/
├── README.md                     ← you are here
├── ARCHITECTURE.md               ← architecture overview + why we write one (diagrams, decisions, failure modes)
├── package.json
├── answers/
│   ├── Q1-best-work.md           ← template + checklist (fill with your project)
│   ├── Q2-debugging-story.md     ← template + worked example (fill with your bug)
│   ├── Q3-order-service-refactor.md   ← full answer: problems, redesign, SOLID
│   └── Q4-lru-cache.md          ← full answer: implementation, O(1) reasoning, scaling
├── src/
│   ├── order-service/            ← redesigned OrderService (service, pricing, validation, Stripe adapter,
│   │                               Postgres repositories, outbox publisher, HTTP handler, composition root)
│   ├── lru-cache/                ← LRUCache (map + doubly linked list) and MapLRUCache (compact variant)
│   └── distributed-cache/        ← RedisCache (cache-aside) and TwoTierCache (L1 LRU + L2 Redis + pub/sub invalidation)
└── tests/                        ← 41 tests using Node's built-in runner (no dependencies)
```

## Run the tests

Requires Node.js 18+ (developed on Node 22). No `npm install` needed: the tests use only built-ins and in-memory fakes.

```bash
npm test
```

Expected: `# tests 41  # pass 41  # fail 0`.

## Answer summary

### Q3: OrderService refactor

**~15 problems found**, grouped as:
- **Security:** SQL injection; caller-supplied `userId`; PII in logs
- **Correctness:** float money; unchecked query results; no input validation; wrong Stripe API usage; missing `RETURNING`; no stock check
- **Reliability:** no transaction/compensation; email failure fails a paid order; generic errors; no idempotency
- **Performance:** N+1 queries
- **Design:** SRP, DIP, OCP, ISP violations

**Redesign:** `OrderService` becomes a thin orchestrator over injected `UserRepository`, `ProductRepository`, `PricingService`, `OrderRepository`, `PaymentGateway`, `EventPublisher`, `Logger`. Order is persisted `PENDING` → charged (idempotent) → marked `PAID` → event published via a transactional outbox.

**Why SOLID matters for a fast-shipping team:** small isolated units, fast tests with fakes, and stable contracts make changes safe, so speed comes from safety, not from skipping structure.

### Q4: LRU cache

- **Structure:** `Map` (key → node) + doubly linked list (recency order) with sentinels → `get`/`put` are **O(1)**.
- **Why not array/object:** array needs O(n) search/shift; object has O(1) lookup but no recency order, so eviction is O(n).
- **Multi-instance:** shared **Redis** (cache-aside, `allkeys-lru`, TTL + jitter, single-flight, fail-open) is the default; add an in-process **L1 LRU** with pub/sub invalidation only if profiling justifies it; DynamoDB suits durable data more than a hot cache.
- **Trade-offs:** latency vs consistency vs operational complexity, covered in detail in `answers/Q4-lru-cache.md`.

## Why an architecture overview?

See [`ARCHITECTURE.md`](ARCHITECTURE.md), section 1. In short: it gives the team a shared mental model, speeds onboarding, records *why* decisions were made, surfaces failure modes before production does, and lets people work in parallel without stepping on each other. The rest of that document contains the system diagram, layer diagram, order-creation sequence, caching flow, failure-mode table, and decision records.

## Cross-cutting themes

Stateless services · shared cache with graceful degradation · async work through queues · idempotent operations · clear interfaces between components · design for failure.

## Honest limitations

- `PgRepositories.js`, `StripePaymentGateway.js`, and `compose.example.js` are syntax-checked reference adapters; they are **not** run against a live Postgres or Stripe here. The business logic they plug into is fully tested with in-memory fakes.
- `RedisCache`/`TwoTierCache` are tested against a small fake Redis, not a real cluster.
- Database schema/migrations (unique constraint on `(user_id, idempotency_key)`, `outbox` table, stock column) are described but not included.
