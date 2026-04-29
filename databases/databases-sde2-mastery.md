---
title: "Databases — SDE-2 / SDE-3 System Design Mastery"
description: "Dense, interview-focused database guide: tradeoffs, failures, real-world decisions"
order: 1
---

# Databases — SDE-2 / SDE-3 System Design Mastery (1-Hour Compressed)

> Audience: experienced backend engineer. No textbook. Optimized for interview signal.

---

## 1. Mental Model First

**A database is a *durable state machine* with explicit knobs for consistency, latency, and availability.** Every choice — engine, schema, index, replication, sharding — is moving sliders on the same cube.

```
        Consistency
            │
            │   (you pick one corner; the rest pay)
            │
   Latency ─┼─ Availability
            │
        Cost / Scalability
```

Senior framing to repeat:
> "A DB is a *contract*: 'these writes are durable under this failure model, visible to readers under this isolation level, with this latency/throughput envelope.' Pick the contract first; the engine follows."

Core tradeoffs:
- **Consistency ↔ Latency**: stronger guarantees → coordination → tail latency.
- **Availability ↔ Consistency**: under partition, you serve stale or you reject (CAP).
- **Write throughput ↔ Read throughput**: indexes, materialized views, denorm — every read accelerator is a write tax.
- **Schema rigidity ↔ Evolution speed**: rigid schema = guarantees + migration pain; flexible = velocity + bugs at scale.
- **Cost ↔ Performance**: the cheapest correct system usually beats the fastest fragile one.

---

## 2. The 80/20 — What Interviewers Actually Test

Interviewers test **decision-making under tradeoffs**, not vocabulary.

Top topics by frequency:
1. **SQL vs NoSQL** — *justified* by access pattern, not buzzwords.
2. **Indexing** — composite index ordering, covering indexes, when index *hurts*.
3. **Transactions & isolation** — what anomalies you accept and why.
4. **Sharding** — key choice, hotspots, cross-shard ops.
5. **Replication** — sync vs async, failover, read-after-write.
6. **CAP / PACELC** — applied, not recited.
7. **Hot partitions / hot keys** mitigation.
8. **OLTP vs OLAP** separation.

**Mid-level vs senior signal:**
| Mid-level | Senior |
|---|---|
| "Use Postgres because it's relational." | "Postgres because access pattern is point-lookup + joins, write rate fits a single primary, and we need MVCC for read-heavy reports." |
| "Add an index." | "Add a composite `(tenant_id, created_at DESC)` covering index for the dashboard query; accept ~15% write overhead; monitor bloat." |
| "Shard the DB." | "We don't need to shard yet — vertical first, then read replicas, then partition by tenant when single-primary write QPS hits 60% of ceiling." |
| "Use eventual consistency." | "Eventual is fine for the feed but reads-after-write must be primary-routed for the author for 5 sec via session token." |

---

## 3. SQL vs NoSQL — Crystal-Clear Tradeoffs

**Wrong question**: "SQL or NoSQL?"
**Right question**: "What is the access pattern, what consistency do I need, what's the write/read ratio, and what does the data model look like?"

### When to choose SQL (Postgres / MySQL)
- Relational data with **multi-entity transactions** (payments, orders, inventory).
- Complex queries / ad-hoc analytics on operational data.
- Schema is well-understood and stable-ish.
- Strong consistency + ACID required.
- Write QPS comfortably under single-primary ceiling (~10–50k writes/sec on tuned Postgres).

### When to choose NoSQL
| Type | When | Example |
|---|---|---|
| **Key-Value** (DynamoDB, Redis) | Pure point-lookup by known key, ultra-low latency, massive scale. | Session store, cart, feature flags. |
| **Document** (MongoDB) | Self-contained aggregate per record, flexible/evolving schema, no cross-doc transactions needed. | Product catalog, user profiles. |
| **Wide-column** (Cassandra, ScyllaDB) | Time-series, write-heavy, known query patterns, multi-DC active-active. | IoT, audit logs, messaging. |
| **Graph** (Neo4j) | Multi-hop relationship traversal is the *primary* query. | Fraud rings, social graph, knowledge graph. |
| **Search** (Elasticsearch) | Full-text, faceted, fuzzy queries; secondary index of SoT. | Product search, log search. |

### Real tradeoffs (not slogans)

| Axis | SQL | NoSQL |
|---|---|---|
| Schema | Rigid → safe; migrations cost | Flexible → fast iter; bugs leak in |
| Joins | First-class | Avoid; denormalize at write time |
| Transactions | Multi-row ACID | Usually single-key/single-partition only |
| Horizontal scale | Hard (manual sharding, Vitess, Citus) | Built-in |
| Consistency model | Strong default | Tunable, often eventual |
| Operational maturity | Decades of tooling | Varies wildly |

### Real-world picks
- **Payments / ledger** → Postgres/MySQL. Non-negotiable: ACID, FK constraints, exact arithmetic. Cite **Stripe** (Mongo→Postgres), **Square**, classic ledger pattern.
- **Social feed** → polyglot. Posts in a sharded RDBMS or wide-column; **fan-out cache (Redis)** for timelines; **Cassandra** for inbox storage.
- **Analytics** → never your OLTP DB. Columnar: **Snowflake / BigQuery / ClickHouse / Redshift**. Operational data flows in via CDC.
- **E-commerce catalog** → document DB or denormalized RDBMS + **Elasticsearch** for search; **inventory** must be in a strongly-consistent store.

### Common candidate mistakes
- "MongoDB scales infinitely." → It scales for the *right* access pattern; cross-shard transactions still hurt.
- "SQL doesn't scale." → It scales fine for most apps. Premature sharding is a top failure mode.
- "We'll use NoSQL for flexibility." → Flexibility ≠ correctness. Schema-on-read pushes the bug to the consumer.
- Choosing the DB before defining queries.
- Ignoring **operational** load (backups, upgrades, on-call) when picking exotic stores.

---

## 4. Transactions & Consistency

**ACID in practical terms:**
- **A**tomicity → all-or-nothing; partial-write impossible.
- **C**onsistency → invariants (constraints, FKs, triggers) hold across the txn boundary.
- **I**solation → concurrent txns appear serial *to some degree* (isolation level).
- **D**urability → committed = survives crash (fsync to WAL).

### Isolation Levels — what you *actually* get

| Level | Prevents | Allows | Real example |
|---|---|---|---|
| Read Uncommitted | Nothing useful | Dirty reads | Almost no one uses |
| **Read Committed** (Postgres default) | Dirty read | Non-repeatable read, phantom, lost update | Most OLTP — fine if you use `SELECT … FOR UPDATE` for hotspots |
| **Repeatable Read** (MySQL InnoDB default; Postgres = snapshot iso) | + Non-repeatable read | Phantom (in MySQL); Postgres SI also catches phantoms via snapshot | Reports inside a txn; multi-row reads |
| **Serializable** (true) | Everything | — | Financial postings, double-entry; expensive |
| **Snapshot Isolation** (Postgres "RR") | Most anomalies | **Write skew** | Need explicit locks for invariants like "at least one doctor on call" |

### Anomalies (interview classics)
- **Dirty read** — see uncommitted data.
- **Non-repeatable read** — same row, two reads, different value.
- **Phantom read** — same predicate, two reads, different rowset.
- **Lost update** — two txns read X, both write X+1, one wins; the other's update lost. Mitigation: `SELECT … FOR UPDATE`, optimistic concurrency with version column, or `UPDATE ... WHERE version=N`.
- **Write skew** — both txns read overlapping set, both write disjoint rows, neither sees the other; invariant violated. Only `SERIALIZABLE` (or app-level locking) prevents.

### Strong vs eventual — when each
- **Strong required**: money, inventory at checkout, idempotency keys, auth tokens, rate-limit counters that must be exact.
- **Eventual fine**: feeds, view counts, recommendations, search index, denormalized aggregates, analytics dashboards (with bounded staleness SLO).

Senior line:
> "Pick the *weakest* consistency model that satisfies the business invariant. Stronger costs latency and availability under partition."

---

## 5. CAP + PACELC

**CAP** (only relevant during a network partition):
- **C**onsistency: every read sees the latest write.
- **A**vailability: every request gets a response.
- **P**artition tolerance: system keeps working despite dropped messages.
- **You always have P. You choose C or A under partition.**

**PACELC** (the part that actually matters in normal ops):
> "If **P**artition: trade **A** vs **C**. **E**lse: trade **L**atency vs **C**onsistency."

The "ELC" is the daily reality — most "CP" systems are actually trading latency for consistency 99.99% of the time.

| System | CAP under partition | ELC default | Notes |
|---|---|---|---|
| Postgres (single primary) | CP | EC | Loses A on primary partition until failover |
| DynamoDB | AP / CP (configurable) | EL by default; EC with strong-read | Strong read = 2x cost |
| Cassandra | AP | EL (tunable per query: ONE/QUORUM/ALL) | "Tunable consistency" |
| MongoDB | CP | EC (with majority writes) | `writeConcern=majority` recommended |
| Spanner / CockroachDB | CP | EC (Paxos/Raft) | Latency cost = wide-area consensus |
| Redis Cluster | AP-leaning | EL | Async replication; can lose writes on failover |

Real-world framing:
> "Modern systems aren't strictly CP or AP — they expose **per-request knobs** (write concern, read concern, consistency level). The interesting question is what *default* the team picks."

---

## 6. Indexing & Query Performance

**Mental model**: an index is a **denormalized, sorted, write-time-maintained data structure** that turns `O(N)` scans into `O(log N)` lookups — at the cost of **write amplification + storage**.

### Index types — when each
| Type | Best for | Bad at |
|---|---|---|
| **B-Tree** (default everywhere) | Range scans, ORDER BY, equality | Very high cardinality writes |
| **Hash** | Pure equality lookups | Range queries (no ordering) |
| **Bitmap** | Low-cardinality columns in OLAP | OLTP writes (rebuild cost) |
| **GIN / inverted** | Full-text, JSONB, arrays | Range on scalars |
| **GiST / R-Tree** | Geospatial, ranges | General-purpose |
| **LSM-tree** (engine-level) | Write-heavy, sequential writes | Read amplification, compaction stalls |

### Composite index — *the* senior topic
- Order matters: `(tenant_id, created_at)` serves `WHERE tenant_id=X` and `WHERE tenant_id=X ORDER BY created_at`. **Does not** serve `WHERE created_at > Y` alone.
- **Leftmost prefix rule** (B-Tree).
- **Covering index** (`INCLUDE` / index-only scan): all columns the query needs are in the index → no heap fetch. Massive win for hot read paths.

### When indexes *hurt*
- Write-heavy tables: every insert/update touches every index. 10 indexes ≈ 10× write IO.
- Low-selectivity columns (gender, boolean) — planner ignores or scans more.
- Frequent updates to indexed columns → index churn + bloat.
- Too many indexes → planner picks wrong one; vacuum/maintenance pain.
- Indexes on small tables — full scan is cheaper.

Senior heuristics:
- "Index for the **slow query you have**, not the one you might."
- Always check `EXPLAIN ANALYZE` — planner may ignore your index due to stats.
- Drop unused indexes (`pg_stat_user_indexes`, MySQL `sys.schema_unused_indexes`).

---

## 7. Sharding — Deep but Practical

**Why**: single-primary write QPS, storage size, or IOPS hits a wall vertical scaling can't fix.

> Senior rule: "Don't shard until you must. Sharding is a one-way door — joins, transactions, and uniqueness all get harder."

### Strategies

| Strategy | How | Wins | Loses |
|---|---|---|---|
| **Range-based** | `user_id 0–1M → shard A`, `1M–2M → B` | Range scans cheap | **Hotspots** (sequential IDs hammer last shard) |
| **Hash-based** | `shard = hash(key) % N` | Even distribution | Range scans require fan-out; resharding rehomes everything |
| **Consistent hashing** | Hash key onto ring; `1/N` keys move on add/remove | Smooth rebalancing | Slightly uneven; fixed by **vnodes** |
| **Directory / lookup-based** | Mapping table `tenant_id → shard` | Flexible, can rebalance per-tenant | Lookup service is SPOF; extra hop |
| **Geo / tenant-based** | Shard by region or customer | Data locality, compliance | Cross-tenant queries hard |

### Real problems (interview gold)
- **Hot shard** — celebrity user, popular tenant. Mitigation: **split key** (`user_id#bucket`), **replicate hot shard**, **per-tenant isolation** for whales.
- **Rebalancing** — moving data online without downtime. Use **dual-write + backfill + cutover**, or strategies like Vitess `MoveTables`.
- **Cross-shard joins / transactions** — *avoid*. Denormalize at write, or do scatter-gather + app-side join. Distributed txns (2PC) are slow + fragile.
- **Unique constraints across shards** — only safe per-shard. Global uniqueness needs a separate strongly-consistent store (e.g., a Postgres "names" table).
- **Secondary indexes** — local (per-shard, fast write, fan-out read) vs global (extra write coordination).

### Consistent hashing — intuition
- Map nodes + keys to a ring (hash space).
- Key → next node clockwise.
- Add/remove a node → only `1/N` of keys move (vs ~all with `hash % N`).
- **Virtual nodes**: each physical node owns many ring positions → smooths skew.

---

## 8. Replication

### Topologies
| Topology | Pros | Cons | Used by |
|---|---|---|---|
| **Leader-Follower** (single-leader) | Simple consistency model; easy reads-from-replica | Write bottleneck on leader; failover risk | Postgres, MySQL, MongoDB |
| **Multi-Leader** | Multi-DC active-active; lower write latency | **Conflict resolution** (LWW, CRDT, app-level) | Some Cassandra setups, BDR, CouchDB |
| **Leaderless** (quorum) | Highly available; no failover | Eventually consistent; read repair / hinted handoff | Cassandra, DynamoDB (Dynamo paper) |

### Sync vs Async
- **Sync**: leader waits for at least one follower's ack → no data loss on failover, **+latency** on every write.
- **Async**: ack on leader durability → lowest latency, **risk: replica lag → lost writes if leader dies**.
- **Semi-sync** (MySQL): wait for *one* replica's ack, the rest async. Pragmatic middle.

### Tradeoffs to verbalize
- **Read replicas** → scale reads, but reads are *stale* (replica lag).
- **Read-your-writes** → route the writer's reads to the primary for a window, or use session tokens / write-LSN.
- **Quorum** (`R + W > N`) → tunable strong read in Dynamo-style systems.

### Failover challenges
- **Split brain** — two nodes both think they're leader. Mitigation: **fencing tokens**, **quorum-based leader election** (Raft/Paxos), **STONITH**.
- **Lost writes** — async replica promoted before catching up. Mitigation: synchronous replication, or `wait_for_lsn` before promote.
- **Failover storm** — flapping network triggers repeated failovers. Mitigation: hysteresis, lease-based leadership.

---

## 9. Scaling Patterns

| Pattern | When | Limits |
|---|---|---|
| **Vertical scale** | Small/medium load; first move always | Cost curve goes vertical; single point of failure |
| **Read replicas** | Read-heavy; tolerate stale reads | Don't help writes; lag |
| **Caching** (separate layer) | Hot read set; tolerable staleness | Invalidation complexity |
| **Partitioning** (within one DB) | Manageability, parallel maintenance | Doesn't add write capacity by itself |
| **Sharding** (across DBs) | Write/storage ceiling hit | Cross-shard ops, ops complexity |
| **CQRS / read models** | Read shape ≠ write shape | Eventual; sync pipeline |

**Partitioning vs Sharding (clear distinction):**
- **Partitioning** = splitting a table into pieces *within the same DB instance* (Postgres declarative partitioning). Helps maintenance, query pruning. Same write QPS ceiling.
- **Sharding** = splitting data *across multiple DB instances*. Adds write capacity. Adds operational pain.

Order to apply (cheapest → costliest):
1. Bigger box (vertical).
2. Read replicas.
3. Cache hot reads.
4. Partition large tables.
5. Move OLAP off OLTP.
6. Shard.
7. Multi-region.

---

## 10. Failure Modes & Real Issues

| Failure | What it is | Mitigation |
|---|---|---|
| **Split brain** | Two leaders during partition; conflicting writes. | Quorum election, fencing tokens, lease + heartbeat. |
| **Replication lag** | Replicas trail leader; stale reads, failover loss. | Monitor lag SLO; route critical reads to primary; semi-sync; `wait_for_lsn`. |
| **Hot partition / hot key** | One shard saturates while others idle. | Key splitting, salting, replicate hot key, pre-split, application-level cache. |
| **Write amplification** | One logical write → many physical writes (LSM compaction, indexes, WAL). | Fewer indexes, bigger SSTables, tune compaction, separate hot/cold tables. |
| **Long transactions** | Hold locks/snapshots → bloat (Postgres), blocking. | Short txns, statement timeouts, avoid `idle in transaction`. |
| **Schema migrations** | Locking ALTER on big table → outage. | Online migration tools (gh-ost, pt-online-schema-change), expand-contract pattern. |
| **N+1 queries** | App fires 1 query + N lookups in a loop. | Eager loading, batched queries, dataloader pattern. |
| **Connection storm** | Too many app connections → DB OOM. | PgBouncer / proxy, connection pool tuning. |
| **Vacuum/compaction stalls** | MVCC bloat or LSM compaction blocks IO. | Tune autovacuum; monitor; off-peak compaction. |
| **Thundering herd on cache miss** | Cache expires → all traffic to DB. | Single-flight, jittered TTL, request coalescing (see caching notes). |

---

## 11. Real System Design Mapping

### Payments / Ledger
- **Engine**: Postgres / MySQL (or Spanner / CockroachDB for global).
- **Why**: ACID, FK, exact decimals, multi-row txn for double-entry.
- **Patterns**: idempotency keys (unique index), outbox pattern for events, append-only ledger table, never UPDATE money rows.
- **Consistency**: strong, serializable for postings.
- **Scale**: shard by `merchant_id` once single primary saturates. Reporting via CDC → warehouse.
- **Senior note**: "Money is not a counter; it's an event log. Sums are derived."

### Social Media Feed
- **Posts SoT**: sharded RDBMS or wide-column (Cassandra).
- **Timeline cache**: Redis lists per user (fan-out-on-write) — but **fan-out-on-read for celebrities** to avoid 100M-key writes.
- **Counts** (likes/views): approximate, eventually consistent (Redis HyperLogLog, write-back counter).
- **Search**: Elasticsearch as secondary index.
- **Consistency**: eventual; reads-after-write for the *author* via session pinning.

### Analytics (OLAP)
- **Engine**: ClickHouse / BigQuery / Snowflake / Redshift (columnar).
- **Why**: aggregations over billions of rows, scan-heavy, write-batch.
- **Pipeline**: OLTP → CDC (Debezium) → Kafka → warehouse / lakehouse.
- **Never**: run analytics on OLTP — kills the primary.
- **Senior note**: "OLTP is for *transactions*; OLAP is for *aggregations*. They're different physics — row vs column store."

### E-commerce
- **Catalog**: read-heavy, mostly static → document DB or RDBMS + heavy caching + CDN. Search → Elasticsearch.
- **Inventory**: strong-consistency store; decrement at *checkout*, not page view.
- **Orders**: ACID RDBMS; outbox → fulfillment events.
- **Cart / session**: Redis (KV).
- **Recommendations**: separate ML store + cache.
- **Senior note**: "Different parts of one product use different DBs — pick per access pattern, not per company standard."

---

## 12. "Say This in Interview"

1. "I'd start by characterizing the access pattern and consistency requirements before naming any database."
2. "Postgres scales further than people assume — I'd exhaust vertical + read replicas + partitioning before sharding."
3. "Sharding is a one-way door; the moment you shard, joins, uniqueness, and transactions become app-level problems."
4. "I pick the *weakest* consistency model that satisfies the business invariant — stronger guarantees cost latency and availability."
5. "ACID isn't binary — Postgres's default Read Committed allows lost updates; I'd use `SELECT FOR UPDATE` or optimistic concurrency at hot rows."
6. "Snapshot isolation prevents most anomalies but not write skew — for invariants like 'at least one on call' I'd add explicit locks or move to serializable."
7. "Replication lag is a *correctness* concern, not just performance — I'd bound it with an SLO and route critical reads to the primary."
8. "For idempotency, I rely on a unique index on the idempotency key — DB enforcement beats app-level checks."
9. "Indexes are write taxes; I add them for measured slow queries, not speculative ones."
10. "Composite index ordering matters — I design it to match the query's WHERE + ORDER BY, then make it covering if hot enough."
11. "Hot keys are inevitable at scale — I'd pre-split, salt, or replicate the hot key before it bites."
12. "Money lives in an append-only ledger; balances are derived. UPDATE on a money row is a bug waiting to happen."
13. "OLAP queries do not belong on the OLTP primary — I'd ship via CDC to a columnar store."
14. "Failover should be *boring* — quorum election, fencing tokens, semi-sync replication, and rehearsed runbooks."
15. "Most production DB outages are not engine bugs; they're long transactions, missing indexes, runaway migrations, or connection storms."

---

## 13. Rapid-Fire Q&A

**Q: When would you NOT use Postgres?**
- True multi-region active-active writes (use Spanner/Cockroach), petabyte-scale append-only telemetry (Cassandra/ClickHouse), pure KV at extreme QPS (DynamoDB/Redis), graph traversal as primary query (Neo4j).

**Q: Read Committed vs Repeatable Read — which by default?**
- Read Committed for most OLTP (Postgres default); RR (snapshot) when a transaction does multiple reads that must agree. Pay the bloat cost knowingly.

**Q: How do you guarantee idempotency on a `POST /payments`?**
- Client sends idempotency key; DB has unique index on `(merchant_id, idempotency_key)`; first insert wins, retries hit the unique violation and return the original result.

**Q: Cache vs read replica?**
- Cache for hot subset, lower latency, app-controlled TTL. Read replica for general read scaling, slightly stale, SQL-compatible. Often both.

**Q: How to migrate a 500GB table without downtime?**
- Expand-contract: add new column nullable → backfill in batches → dual-write → switch reads → drop old. Tools: `pg_repack`, `gh-ost`, `pt-online-schema-change`.

**Q: How to pick a shard key?**
- High cardinality, even distribution, aligned with most common query, stable (doesn't change for a row's lifetime). Avoid monotonic IDs (timestamp, autoincrement).

**Q: What breaks first when you scale a Postgres primary?**
- Usually **connections** (use PgBouncer), then **vacuum/bloat**, then **WAL throughput**, then **single-CPU bottleneck on a hot query**.

**Q: 2PC vs Saga?**
- 2PC = strong, blocking, slow, fragile across services. Saga = compensating actions, eventually consistent, app-level orchestration. Prefer Saga across services; reserve 2PC for short, in-DC, infrequent.

**Q: Why is `OFFSET` pagination bad?**
- O(N) scan; latency grows with page number. Use **keyset / cursor pagination** (`WHERE id > last_id ORDER BY id LIMIT N`).

**Q: How to handle a celebrity user in a sharded DB?**
- Detect (popularity signal) → replicate that key/row to multiple shards → app reads from random replica → writes still go to primary or use CRDT counters.

**Q: Postgres or MongoDB for a new product?**
- Postgres unless you can articulate a *specific* MongoDB advantage (deeply nested aggregates accessed only as a unit, true schemaless evolution). Postgres now has JSONB + GIN — covers most "I want NoSQL" cases.

**Q: A query is slow. Walk through your debug.**
- `EXPLAIN ANALYZE` → check seq scan vs index → check row estimates vs actual (stats stale → ANALYZE) → check index selectivity → consider covering index → check locks/blocking → check function-based predicates that defeat indexes.

**Q: Difference between materialized view and table?**
- Materialized view = derived data, refreshable, can be indexed. Table = SoT. Use MV for expensive aggregates with bounded staleness.

---

## 14. 5-Minute Revision Sheet

- **DB choice = access pattern + consistency + scale, not buzzword.**
- **Default to Postgres.** Reach for NoSQL when access pattern proves it.
- **Pick weakest consistency that holds the invariant.**
- **ACID isolation defaults**: PG = Read Committed, MySQL InnoDB = Repeatable Read.
- **Key anomaly senior trap**: write skew under snapshot isolation → needs serializable or locks.
- **CAP under partition; PACELC every other day**: latency vs consistency.
- **Indexes**: composite ordering = WHERE + ORDER BY; covering = no heap fetch; every index = write tax.
- **Don't shard early.** Vertical → replicas → cache → partition → shard.
- **Shard key**: high-cardinality, even, aligned with query, stable.
- **Hot key fixes**: salt, split, replicate, pre-split.
- **Replication**: sync = no loss + latency; async = fast + risk; semi-sync = pragmatic.
- **Split brain → fencing + quorum + leases.**
- **Read-after-write**: route to primary or use LSN/session token.
- **OLTP ≠ OLAP** — ship via CDC to columnar.
- **Money = append-only ledger; balance = derived.**
- **Idempotency = unique index on key.**
- **Migrations = expand-contract, never lock big tables.**
- **N+1, missing index, long txn, connection storm = top OLTP outages.**
- **Cursor pagination, not OFFSET.**
- **Schema-on-write catches bugs early; schema-on-read pushes them to prod.**
- **Your DB is a contract — pick it, then defend it with tradeoffs.**

---
*End of sheet — drill section 12 ("Say This in Interview") until reflexive.*
