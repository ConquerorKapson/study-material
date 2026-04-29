# Caching — SDE-2 / SDE-3 System Design Mastery (1-Hour Compressed)

> Audience: experienced backend engineer. No basics. Optimized for interview signal.

---

## 1. Mental Model First

**Cache = a *consistency-for-latency* trade.** You are deliberately serving *possibly wrong* data *much faster* and *much cheaper* than the source of truth (SoT).

Three-axis mental model — every caching decision is a point in this cube:

```
   Latency  ── (lower = better)
      │
      │        (you pick a point;
      │         you cannot win on all axes)
      │
      └──── Consistency ── (stronger = slower / costlier)
             │
           Cost / Complexity
```

Key invariant to repeat in interviews:
> "A cache is a *materialized denormalization of the SoT under a TTL or invalidation contract*. Every design choice is about *who* owns that contract — the writer, the reader, or time."

Core tradeoffs:
- **Latency ↔ Consistency**: stronger consistency → more SoT reads or coordination.
- **Hit-rate ↔ Memory cost**: bigger/longer-lived cache → more stale risk + RAM cost.
- **Simplicity ↔ Correctness**: write-through is simple but couples writes; cache-aside is flexible but races.
- **Availability ↔ Correctness**: serving stale on SoT failure (graceful degradation) vs. failing closed.

---

## 2. The 80/20 — What Interviewers Actually Test

Interviewers are testing *whether you understand failure modes and consistency*, not whether you can name patterns.

Top topics by frequency:
1. **Cache-aside vs write-through** + when each breaks.
2. **Invalidation strategy** (TTL vs event-driven vs versioned keys).
3. **Stampede / thundering herd** mitigation.
4. **Hot-key** handling.
5. **Consistent hashing** + rebalancing.
6. **Read-after-write consistency** in cache + DB systems.
7. **What goes in cache vs CDN vs in-process vs DB buffer pool** (tiering).
8. **Eviction** — only LRU vs LFU tradeoff + why TinyLFU exists.

What they're really probing:
- Do you reason about **races** between writers and cache populators?
- Do you know **what happens when the cache dies** (cold-start storm)?
- Can you pick a **TTL with justification**, not a random "5 minutes"?

---

## 3. Core Patterns (with when NOT to use them)

| Pattern | Flow | Use when | Breaks when | Real example |
|---|---|---|---|---|
| **Cache-aside (lazy)** | App reads cache → miss → reads DB → populates cache. Writes go to DB; cache invalidated/updated separately. | Read-heavy, tolerant of brief staleness, mixed access patterns. | Write-heavy workloads; race: writer updates DB, slow reader writes stale value to cache *after* invalidation. | Most web apps with Redis + Postgres. |
| **Read-through** | App talks only to cache; cache loads from DB on miss. | You want to centralize cache logic in a library/proxy; uniform key handling. | Cache layer becomes SPOF; harder to do partial/derived caching. | DynamoDB DAX, Hibernate L2. |
| **Write-through** | Write hits cache, cache synchronously writes to DB. | Strong-ish read-after-write within cache; simple consistency story. | High write latency; wasted cache space for write-only data; dual-write failure if not transactional. | Some financial ledgers w/ in-memory tier. |
| **Write-back (write-behind)** | Write goes to cache; flushed to DB async (batched). | Massive write throughput, can tolerate data loss window. | **Data loss on crash**; ordering bugs; hard recovery. | Metrics pipelines, counters, Kafka-fronted DBs. |
| **Refresh-ahead** | Proactively refresh hot keys before TTL expiry. | Predictable hot keys, latency-critical (e.g., homepage). | Wastes work on cold keys; needs popularity signal. | News homepage, leaderboard. |

Race to memorize (cache-aside write race):
1. T1 reads DB v1, about to set cache.
2. T2 writes DB v2, deletes cache.
3. T1 sets cache = v1 → **stale forever (until TTL)**.
Mitigation: *delete after write* + *short TTL* + *versioned keys* + *single-flight populate*.

---

## 4. Eviction — Only the Important Insight

- **LRU**: great default; **fails on scan workloads** (one big scan evicts your hot set).
- **LFU**: better for skewed popularity; **fails on shifting popularity** (yesterday's hot key squats forever).
- **FIFO**: cheap, dumb; useful only when access pattern ≈ insertion order.
- **TinyLFU / W-TinyLFU** (Caffeine): admission filter using frequency sketch in front of LRU. Beats both LRU and LFU on real workloads. **This is what you cite to sound senior.**

**Redis specifics** (be exact):
- Default `maxmemory-policy` is `noeviction` (writes fail when full — bites people in prod).
- Common pick: `allkeys-lru` for caches, `volatile-lru` if you mix cache + persistent data.
- Redis LRU is **approximate** (samples N keys, evicts worst) — not true LRU. `allkeys-lfu` available since 4.0 and is often better for skewed traffic.

Insight to drop: *"Pure LRU is theoretically optimal under LRU-stack assumptions but real workloads are Zipfian with scan pollution, which is why production caches use admission policies like TinyLFU."*

---

## 5. Cache Invalidation — Deep but Concise

Real problem: **there is no atomic transaction across DB + cache**. Every strategy is a bet on which inconsistency window you can tolerate.

Strategies (production-grade):

1. **TTL only** — simplest; bounded staleness; useless for "must reflect immediately" data.
2. **Write-then-delete (cache-aside invalidation)** — write DB, delete cache key. Race: concurrent reader repopulates with old value. Mitigation: **delete twice** (delayed second delete, "double-delete pattern").
3. **Write-through update** — atomic at cache layer but dual-write failure mode (DB succeeds, cache fails or vice-versa).
4. **Versioned keys** — key includes version/etag (`user:42:v17`). Writes bump version; old keys age out via TTL. **No invalidation race**, costs memory.
5. **CDC / event-driven** — Debezium → Kafka → cache invalidator. Eventual but reliable; decouples writer from cache.
6. **Lease / token** (Memcached leases, Facebook's approach) — miss returns a lease; only lease holder may set; invalidation revokes outstanding leases. Solves stampede + stale set in one mechanism.

Tradeoffs to verbalize:
- TTL → bounded staleness, zero coordination, wasted work on cold keys.
- Event-driven → tightest correctness but adds pipeline as dependency.
- Versioned keys → trades memory for correctness; great for immutable snapshots.

The famous quote — reframe it:
> "Cache invalidation is hard *because the cache and the SoT are two systems with no shared transaction*. Pick the inconsistency you can live with."

---

## 6. Failure Modes (CRITICAL)

| Failure | What it is | Mitigation (1-liner) |
|---|---|---|
| **Cache stampede / thundering herd** | Hot key expires → N concurrent misses all hit DB. | **Single-flight / request coalescing**, **probabilistic early expiration** (XFetch), **mutex/lease** on populate, **stale-while-revalidate**. |
| **Hot key** | One key gets disproportionate traffic, saturates one shard. | **Client-side replication** of key across N nodes, **local in-process cache** in front of distributed cache, **key splitting** (`key#{0..N}`). |
| **Cache penetration** | Lookups for keys that *don't exist* (often malicious) bypass cache → hammer DB. | **Cache negative results** (short TTL), **Bloom filter** of valid keys at edge. |
| **Cache breakdown** | Single very hot key expires → mini-stampede on that key. | **Never expire hot keys**; refresh-ahead; mutex on populate. |
| **Cache avalanche** | Many keys expire simultaneously (same TTL) → mass DB hit. | **Jittered TTLs** (`ttl + rand(0..jitter)`); tiered TTLs. |
| **Cold start / cache flush** | Cache restart → 0% hit rate → DB melts. | **Warm-up scripts**, **gradual traffic ramp**, **request limiting**, replicated/persisted cache (Redis AOF/RDB or warm replica). |
| **Dual-write inconsistency** | DB write succeeds, cache write/delete fails. | Outbox pattern + CDC; or always *delete* (don't update) cache and let next read repopulate. |

---

## 7. Distributed Cache Design

**Consistent hashing — intuition:**
- Map nodes and keys onto a ring (hash space).
- Key goes to the next node clockwise.
- Adding/removing a node only re-homes `1/N` of keys (vs. ~all keys with `hash % N`).
- **Virtual nodes (vnodes)**: each physical node owns many ring positions → smooths load; fixes skew when nodes are heterogeneous or few.

**Rebalancing issues:**
- Bursty backfill on the new node → cold cache → cascading misses.
- Inflight requests during membership change → use **gossip + version** for membership; clients tolerate routing to old node briefly.
- Solution patterns: **hand-off + warmup**, **shadow traffic**, **bounded migration rate**.

**Replication vs partitioning:**
| | Partitioning (sharding) | Replication |
|---|---|---|
| Solves | Capacity, throughput | Availability, read scaling, hot-key |
| Cost | Routing complexity, cross-shard ops impossible | Write amplification, replica consistency |
| Use together | Almost always: shard for capacity + replicate each shard for HA. |

Consistency knobs to mention: **read-your-writes** via sticky routing or version tokens; **quorum reads/writes** if you treat cache as a small Dynamo-style store.

---

## 8. Real System Thinking

### Instagram Feed
- **Fan-out-on-write** to per-user feed cache (Redis list of post IDs) for typical users; **fan-out-on-read** for celebrities (avoid writing to 100M follower caches).
- Hybrid is the senior answer: pull celebrity posts at read-time, merge with pre-computed feed.
- Edge: CDN for images/video; **app server**: in-process LRU for user/profile metadata; **Redis**: feed lists, counters; **DB**: SoT.
- Why: feed reads ≫ writes; staleness of seconds is acceptable; latency budget is tight.

### YouTube / Video Streaming
- **Multi-tier**: browser cache → ISP/edge CDN → regional cache → origin.
- **Segment-level caching** (HLS/DASH chunks are immutable, perfect cache objects with long TTL + content-hash URLs → no invalidation needed).
- Metadata (title, recommendations) cached separately with shorter TTL.
- Hot video → pre-warm regional caches; cold long-tail → origin pull.
- Why: bandwidth cost dominates; immutability of chunks makes caching trivially correct.

### E-commerce Product Page
- **Per-fragment caching**: product description (long TTL), price/inventory (very short TTL or event-invalidated), recommendations (medium TTL, personalized → user-segment keys).
- **Inventory is the trap**: never cache "in stock" boolean naively — use cache for *display* but re-check at *cart/checkout* against SoT.
- CDN for static assets; Redis for session/cart; in-process cache for catalog metadata; search index (Elasticsearch) is itself a denormalized cache.
- Why: read-heavy catalog, write-heavy inventory; mixing them in one TTL is the classic mistake.

---

## 9. "Say This in Interview" — Senior Phrasing

1. "I'd treat the cache as a *contract* between writer and reader, not a side-effect — the contract is either TTL-bounded staleness or event-driven invalidation."
2. "Cache-aside is the default, but the read-populate path races with writes, so I'd pair it with delete-on-write and short TTL as a backstop."
3. "I avoid updating cache on writes; I delete. Updates create dual-write failure modes. Deletes are idempotent."
4. "TTL is a *correctness budget*, not a performance knob — pick it from the business tolerance for staleness."
5. "For hot keys I'd add a small in-process L1 cache in front of Redis; that absorbs the long tail and protects the shard."
6. "Stampede protection is non-negotiable at scale — single-flight populate or probabilistic early expiration."
7. "I'd jitter TTLs to prevent synchronized expiry causing avalanche on the DB."
8. "Negative caching plus a Bloom filter at the edge handles penetration cheaply."
9. "Replication for availability, partitioning for capacity — almost always both, with consistent hashing and vnodes."
10. "For read-after-write, I'd either route the user's reads to the primary for a short window or version the cache key with the write's etag."
11. "I'd never trust the cache for inventory or money — those re-validate against the SoT at the decision point."
12. "Caches should *fail open to slowness, not to wrongness* — when in doubt, bypass."
13. "Most production cache bugs are not cache bugs; they are *invalidation bugs* caused by missing transactional boundaries."
14. "Approximate LRU with an admission filter (TinyLFU) outperforms strict LRU on real Zipfian workloads."
15. "Cold-start is a capacity problem, not a cache problem — design the DB to survive a full cache flush, or you have no SLO."

---

## 10. Rapid-Fire Interview Q&A

**Q: Cache or DB index — which first?**
- DB index first if working set fits in buffer pool. Cache is for cross-request reuse, cross-service fan-out reduction, or precomputed/derived data the DB can't index cheaply.

**Q: How do you choose TTL?**
- Function of (a) business staleness tolerance, (b) write rate, (c) hit-rate target. Start from staleness budget, then validate hit rate empirically. Never a round number without justification.

**Q: Redis cluster goes down. Now what?**
- Circuit-break to direct DB with rate limiting; serve stale from local L1 if available; reject non-critical reads. Plan: warm replica + AOF for fast recovery.

**Q: How do you keep cache consistent with DB on writes?**
- Strict: 2PC or transactional outbox + CDC invalidation. Pragmatic: write DB → delete cache → optional delayed second delete → short TTL backstop.

**Q: Why is `cache.set(key, db.get(key))` on miss dangerous under load?**
- Stampede; concurrent setters race and may write stale value over fresh; do single-flight with mutex/lease.

**Q: Difference between cache-aside and read-through?**
- Cache-aside: app orchestrates DB on miss. Read-through: cache loads itself via plug-in/loader. Read-through hides logic but couples cache with data-loading code.

**Q: When is write-back acceptable?**
- When data loss of last few seconds is acceptable AND you have durable write-ahead log fronting the cache (Kafka, AOF). Counters, metrics, telemetry.

**Q: Why consistent hashing over `hash % N`?**
- `hash % N` re-homes ~all keys on membership change → cache invalidation storm. Consistent hashing → only `1/N`.

**Q: How to handle a single key getting 1M QPS?**
- L1 in-process cache with short TTL; replicate key to N Redis nodes; client picks random replica; or split key (`key#shard`) if value is aggregable.

**Q: Cache returns 200 but value is wrong. How do you debug?**
- Check write path for dual-write race; check TTL; check if multiple writers/invalidators; check for key collision; check for clock skew on TTL.

**Q: How would you cache a paginated list that mutates?**
- Don't cache the list; cache item-by-id and cache the page as a list of IDs with short TTL or version key. Or use cursor-based pagination over an immutable snapshot.

---

## 11. 5-Minute Revision Sheet

- **Cache = denormalization under a TTL/invalidation contract.**
- **Default pattern**: cache-aside + delete-on-write + short jittered TTL.
- **Never update cache on write — delete.**
- **Stampede**: single-flight, lease, probabilistic early expire, stale-while-revalidate.
- **Hot key**: L1 in-process + replicate key + key splitting.
- **Penetration**: negative cache + Bloom filter.
- **Avalanche**: jitter TTL.
- **Breakdown**: don't expire hot keys; refresh-ahead.
- **Cold start**: warm-up + ramp + DB rate-limit.
- **Eviction**: `allkeys-lru` default in Redis (approximate); prefer LFU/TinyLFU for skewed.
- **Consistent hashing + vnodes** for sharding; replicate for HA + hot-key relief.
- **Invalidation strategies**: TTL, write-then-delete (+ double-delete), versioned keys, CDC events, leases.
- **Tiers**: browser → CDN → edge → regional → in-process L1 → distributed L2 → DB buffer pool → DB.
- **Never cache money/inventory at decision points** — revalidate at SoT.
- **Caches fail open to slowness, not to wrongness.**
- **Most "cache bugs" are invalidation bugs = missing transactional boundary.**
- **TTL is a correctness budget, not a perf knob.**
- **Cold-cache survival is a DB capacity problem.**
- **Approximate LRU + admission filter (TinyLFU) > strict LRU on Zipfian traffic.**

---
*End of sheet — drill the "Say This in Interview" lines until they're muscle memory.*
