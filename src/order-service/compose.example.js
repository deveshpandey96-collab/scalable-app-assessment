// Composition root: the ONE place where concrete implementations are wired together.
// Not executed by tests (needs `pg` and `stripe` installed and configured).
import express from "express";
import pg from "pg";
import Stripe from "stripe";
import { OrderService } from "./OrderService.js";
import { PricingService } from "./PricingService.js";
import { StripePaymentGateway } from "./StripePaymentGateway.js";
import { PgUserRepository, PgProductRepository, PgOrderRepository, OutboxEventPublisher } from "./PgRepositories.js";
import { createOrderHandler } from "./http.js";

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const logger = { info: console.log, warn: console.warn, error: console.error };

const orderService = new OrderService({
  users: new PgUserRepository(db),
  products: new PgProductRepository(db),
  orders: new PgOrderRepository(db),
  pricing: new PricingService(),
  payments: new StripePaymentGateway({ stripe }),
  events: new OutboxEventPublisher(db),
  logger,
});

const app = express();
app.use(express.json());
// app.use(authMiddleware)  // sets req.user
app.post("/orders", createOrderHandler({ orderService, logger }));
export default app;
