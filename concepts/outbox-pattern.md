---
title: "The Outbox Pattern"
description: "Solving the dual-write problem in distributed systems — Polling vs CDC, at-least-once delivery, idempotency strategies, and interview tips."
order: 2
---

# The Outbox Pattern

> **Category:** Distributed Systems · **Difficulty:** Intermediate · **Related:** Saga · CDC · At-Least-Once

---

## 01 — The Root Problem

### The Dual-Write Problem

In distributed systems, you often need to do two things together: update your database and notify other services via a message queue. The naive approach does both sequentially — and that's where failure hides.

There is no way to atomically span a DB transaction and a Kafka publish. If your app crashes between them, you end up with one side done and the other not — permanent inconsistency.

> **The Core Insight:** Outbox doesn't make messaging transactional. It makes the *intent to message* part of your DB transaction — and delegates actual delivery to a reliable relay.

### ❌ Without Outbox — Classic Dual-Write Failure

```
// Step 1 — succeeds
UPDATE orders SET status = 'PAID'

// 💥 App crashes here

kafka.publish("order.paid", ...)
→ Never fires.

// Order is PAID in DB.
// Downstream services never knew.
// Result: silent inconsistency
```

---

## 02 — How It Works

### The Mechanism

```
┌─────────────────────────────────────────────────────────┐
│  YOUR SERVICE                                            │
│                                                          │
│   BEGIN TRANSACTION ────────────────────────────────┐   │
│   │                                                  │   │
│   │  INSERT INTO orders  (status='PAID')           │   │
│   │  INSERT INTO outbox  (event='order.paid')      │   │
│   │                                                  │   │
│   COMMIT ◄──────────────── atomic, or both fail ────┘   │
└──────────────────────────┬──────────────────────────────┘
                           │
                ┌──────────▼──────────┐
                │   MESSAGE RELAY      │
                │  (Poller or CDC)     │
                │                      │
                │  reads outbox rows   │
                │  publishes events    │
                │  marks processed     │
                └──────────┬───────────┘
                           │
                ┌──────────▼──────────┐
                │   KAFKA / QUEUE      │
                │                      │
                │  order.paid ────────►│──► Consumer A
                │                      │──► Consumer B
                └──────────────────────┘
```

### Step-by-Step Flow

1. **Single Atomic Transaction** — Business table (e.g. orders) and outbox table are written in the same DB transaction. Both succeed or both fail — no partial state possible.

2. **Relay Reads the Outbox** — A separate process (poller or CDC tool like Debezium) reads rows where `status = 'PENDING'` and publishes them to the message queue.

3. **Mark as Processed** — After successful publish, relay updates the row to `status = 'PROCESSED'` (or deletes it). If relay crashes before this, it will retry — guaranteeing at-least-once delivery.

4. **Consumers Handle Duplicates** — Because of at-least-once, consumers must be idempotent — the same event may arrive twice, and the result must be the same.

---

## 03 — Outbox Table Schema

### Know This Cold

The outbox table is simple but every column has a reason:

```sql
CREATE TABLE outbox (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  VARCHAR(100), -- e.g. "Order", "Payment"
  aggregate_id    VARCHAR(100), -- e.g. order_id = "ord_123"
  event_type      VARCHAR(100), -- e.g. "ORDER_PLACED", "PAYMENT_FAILED"
  payload         JSONB,        -- full event data for consumers
  status          VARCHAR       DEFAULT 'PENDING',
  created_at      TIMESTAMP     DEFAULT NOW(),
  processed_at    TIMESTAMP
);

-- Index for the relay's polling query
CREATE INDEX idx_outbox_status ON outbox (status, created_at)
  WHERE status = 'PENDING';
```

The `id` field serves as the idempotency key — consumers use it to deduplicate. The partial index on status makes polling fast even with millions of processed rows.

---

## 04 — Relay Approaches

### Polling vs. CDC

This is the most important differentiator interviewers ask about. Know both deeply.

| Dimension | Polling Relay | CDC (Debezium) |
|-----------|--------------|----------------|
| **Mechanism** | Scheduler queries outbox every N seconds for PENDING rows | Reads DB transaction log (WAL for Postgres) — reacts to every commit |
| **Latency** | ⚠️ Higher — depends on poll interval (1–10s typical) | ✅ Low — near real-time, milliseconds |
| **DB Load** | ⚠️ Adds load — repeated SELECT queries | ✅ Minimal — reads WAL, not the table |
| **Complexity** | ✅ Simple — a cron job or scheduled task | ⚠️ Higher — Debezium setup, Kafka Connect, config |
| **When to Use** | Lower scale, quick to implement, latency-tolerant | High throughput, latency-sensitive, production grade |
| **Tool** | Custom scheduler / Quartz / pg_cron | Debezium + Kafka Connect |

> **Interview Tip:** Mention CDC + Debezium unprompted. It signals you've thought about this in production, not just in theory. Most candidates only know polling.

---

## 05 — At-Least-Once & Idempotency

### The Guarantee & Its Consequence

Outbox guarantees **at-least-once delivery** — not exactly-once. The relay can publish successfully, then crash before marking the row as processed. On restart, it publishes again. Consumers must handle this.

```
Relay publishes event_id: abc-123  →  💥 crash  →  Relay restarts, publishes event_id: abc-123 again
```

### Three Idempotency Strategies

| Strategy | How | Best For |
|----------|-----|----------|
| **processed_events table** | Consumer inserts event_id into a seen-events table before processing. Skip if already present. | General purpose, reliable |
| **Natural idempotency** | Operation is safe to repeat — e.g. `SET status = 'PAID'` twice is fine | Simple state machines |
| **Conditional logic** | Only process if current state allows it — e.g. only refund if status = 'PAID' | State-driven workflows |

---

## 06 — Real Use Cases

### Where You Actually Use This

- 🛒 **E-Commerce Orders** — When an order is placed, atomically save it and queue events for inventory service, notification service, and billing — in one transaction.

- 💳 **Payment Processing** — Record a payment and emit `payment.completed` atomically. Downstream fraud detection and reconciliation services consume reliably.

- 📧 **Email / Notification Triggers** — User signs up → save user row + outbox event together. Email service reads outbox and sends welcome email. No missed sends.

- 🔄 **Saga Orchestration** — Outbox is a natural fit for Saga pattern — each step publishes its completion event via outbox, triggering the next step reliably.

- 📊 **Analytics / Read Models** — Propagate DB changes to Elasticsearch or a data warehouse without dual writes. Outbox events keep read models in sync.

- 🔗 **Microservice Sync** — When service A updates its domain, it reliably informs services B and C without direct coupling or synchronous calls.

---

## 07 — Tradeoffs

### What You're Giving Up

- ⏱ **Added Latency** — Messages are not instant. They go through the relay loop. Polling adds more; CDC reduces this significantly.

- 🏗 **Operational Overhead** — You maintain an extra table, a relay process, and need to monitor relay health. Debezium adds connector config complexity.

- 🔁 **Consumer Complexity** — Every consumer must handle duplicate events gracefully. This is a cross-cutting concern you must enforce across teams.

---

## 08 — Interview Summary

### Say This to Close

> "Outbox pattern solves the dual-write problem by writing the message intent into the same DB transaction as the business data, then using a relay — ideally CDC via Debezium — to deliver it to the queue asynchronously, guaranteeing at-least-once delivery with idempotent consumers handling duplicates."
