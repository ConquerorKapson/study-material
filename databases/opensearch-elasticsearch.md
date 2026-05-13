---
title: "OpenSearch & Elasticsearch"
description: "Tech Lead interview guide — architecture, indexing, Query DSL, BM25, k-NN vector search, production tuning, and OpenSearch vs Elasticsearch decision framework."
order: 2
---
# OpenSearch & Elasticsearch — Tech Lead Interview Study Notes

---

## 1. What They Are & How They Relate

**Elasticsearch** is a distributed search and analytics engine built on top of Apache Lucene. Developed by Elastic (elastic.co), it became the industry standard for full-text search, log analytics, and real-time data exploration.

**OpenSearch** is a community-driven, open-source fork of Elasticsearch 7.10.2, created by AWS in 2021 after Elastic changed its license from Apache 2.0 to the Server Side Public License (SSPL) — which is not OSI-approved open source. OpenSearch is governed by the OpenSearch Project and is fully Apache 2.0 licensed.

**The fork moment:** In January 2021, Elastic relicensed Elasticsearch and Kibana under SSPL. AWS (a heavy user and redistributor of Elasticsearch) forked version 7.10.2 and released OpenSearch 1.0 in September 2021. The APIs were kept deliberately compatible.

```
Elasticsearch (Apache 2.0) 
    └── versions up to 7.10.2
    └── forked by AWS → OpenSearch 1.0 (Sept 2021)

Elasticsearch (SSPL) 
    └── versions 7.11+ onward
    └── continues independently under Elastic
```

**As of 2024:** OpenSearch is at version 2.x with significant feature additions (k-NN vector search, ML commons, security plugin). Elasticsearch relicensed back to AGPL in August 2024 — but OpenSearch continues independently.

---

## 2. Architecture Deep Dive

### Core Concepts

| Concept | Description |
|---|---|
| **Index** | Equivalent to a database table. A collection of documents sharing a mapping. |
| **Document** | A JSON object — the unit of storage and retrieval. |
| **Shard** | A single Lucene instance. An index is split into N primary shards for horizontal scale. |
| **Replica** | A copy of a primary shard. Provides redundancy and read throughput. |
| **Node** | A single server in the cluster. Roles: master, data, ingest, coordinating. |
| **Cluster** | A collection of nodes with a shared cluster name. |
| **Segment** | Immutable Lucene file on disk. Shards are made of segments. |
| **Inverted Index** | The core data structure. Maps terms → document IDs for fast full-text lookup. |

### Node Roles

```
Cluster
├── Master-eligible nodes   (cluster state management, index creation, shard allocation)
├── Data nodes              (store shards, handle CRUD + search on local shards)
├── Ingest nodes            (pre-process docs via pipelines before indexing)
├── Coordinating nodes      (route requests, scatter-gather search results)
└── ML nodes (OpenSearch)   (run ML models, anomaly detection)
```

A node can have multiple roles. In production, always dedicate master-eligible nodes — never let data nodes be master-eligible on large clusters.

### Shard Lifecycle

```
Index created (primary_shards=3, replicas=1)
→ 3 primary shards distributed across data nodes
→ 3 replica shards placed on different nodes than their primaries
→ Total = 6 shards in cluster

Write path:
  Client → Coordinating node → Primary shard (write + replicate) → Replica shards
  
Read path:
  Client → Coordinating node → Round-robin between primary or replica → Merge results
```

**Shard sizing rule of thumb:** Keep shards between 10–50 GB. Too small = overhead. Too large = slow recovery, GC pressure.

### The Inverted Index (Lucene)

When you index a document, the text is analyzed (tokenized, lowercased, stemmed) and stored as:

```
Term        → Document IDs
"payment"   → [doc_1, doc_4, doc_9]
"order"     → [doc_1, doc_2, doc_7]
"failed"    → [doc_4, doc_9]
```

A search for `"payment failed"` becomes an intersection of those posting lists — extremely fast even over billions of documents.

---

## 3. Elasticsearch vs OpenSearch — Key Differences

| Area | Elasticsearch | OpenSearch |
|---|---|---|
| License | SSPL (7.11+), AGPL (8.9+) | Apache 2.0 |
| Governance | Elastic (company) | OpenSearch Project (community + AWS) |
| Managed cloud | Elastic Cloud | Amazon OpenSearch Service |
| Vector search | kNN via dense_vector | k-NN plugin, FAISS, Nmslib, Lucene engine |
| ML features | Elastic ML (RLHF, ELSER) | ML Commons, neural search |
| Security | X-Pack (paid tier historically) | Security plugin — free, bundled |
| Kibana equivalent | Kibana | OpenSearch Dashboards |
| Logstash equivalent | Logstash | Data Prepper |
| API compatibility | Reference implementation | ~95% compatible with ES 7.10 API |
| Alerting | Watcher (paid) | Alerting plugin (free) |

**Tech lead note:** If you're on AWS infrastructure, OpenSearch Service is the natural choice — no licensing concern, deeply integrated with IAM, VPC, CloudWatch. If you need Elastic's proprietary ML models (ELSER for semantic search) or support contract with Elastic, stay on Elasticsearch.

---

## 4. Indexing — How Documents Get Stored

### Write Path Detail

```
1. Client sends PUT /orders/_doc/ord_891 { "status": "PAID", "amount": 2400 }
2. Request hits coordinating node
3. Coordinating node computes shard = hash(ord_891) % num_primary_shards
4. Request forwarded to primary shard's node
5. Primary shard writes to in-memory buffer + translog (WAL equivalent)
6. Primary forwards to replica shards in parallel
7. Once majority replicas ACK → client gets 200 OK
8. In background: refresh (every 1s) writes buffer → new Lucene segment (now searchable)
9. In background: flush (every 30min or translog threshold) → fsync segment to disk, clear translog
```

### Refresh vs Flush vs Merge

```
Refresh (default: every 1 second)
  → Moves docs from in-memory buffer to a new Lucene segment
  → Docs become searchable
  → NOT durable (segment not fsynced yet)
  → Cost: moderate — tune refresh_interval to 30s or -1 during bulk indexing

Flush (triggered automatically or via API)
  → fsyncs segments to disk
  → Clears the translog
  → Durable write
  → Cost: high I/O

Segment Merge (background)
  → Combines many small segments into fewer large ones
  → Deletes marked-deleted documents
  → Frees disk space, improves search speed
  → Cost: high CPU + I/O — throttle with index.merge.scheduler.max_thread_count
```

**Interview answer:** "Near real-time" means documents are searchable within ~1 second (one refresh cycle) — not instantly after the write ACK. You can force immediate searchability with `?refresh=true` or `?refresh=wait_for` but at a performance cost.

### Bulk Indexing Best Practices

```json
POST /_bulk
{ "index": { "_index": "orders", "_id": "ord_891" } }
{ "status": "PAID", "amount": 2400, "created_at": "2024-01-15T10:44:22Z" }
{ "index": { "_index": "orders", "_id": "ord_892" } }
{ "status": "PENDING", "amount": 1800, "created_at": "2024-01-15T10:44:25Z" }
```

For high-throughput indexing:
- Set `refresh_interval: -1` during the load, restore to `1s` after
- Set `number_of_replicas: 0` during load, restore after
- Use bulk API with 5–15 MB batches
- Use multiple parallel bulk threads (match data node count)

---

## 5. Mappings & Data Types

Mappings define the schema — field types, analyzers, index settings. Always define explicit mappings in production. Dynamic mapping is convenient but dangerous at scale.

```json
PUT /orders
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  },
  "mappings": {
    "properties": {
      "order_id":    { "type": "keyword" },
      "customer_id": { "type": "keyword" },
      "status":      { "type": "keyword" },
      "amount":      { "type": "double" },
      "description": { "type": "text", "analyzer": "standard" },
      "tags":        { "type": "keyword" },
      "created_at":  { "type": "date", "format": "strict_date_optional_time" },
      "location":    { "type": "geo_point" },
      "embedding":   { "type": "knn_vector", "dimension": 768 }
    }
  }
}
```

### `text` vs `keyword` — Most Common Interview Question

| | `text` | `keyword` |
|---|---|---|
| Use for | Full-text search (product names, descriptions) | Exact match, filtering, aggregations, sorting |
| Analyzed? | Yes — tokenized, lowercased, stemmed | No — stored as-is |
| Aggregatable? | No (by default) | Yes |
| Example | `"Payment failed for order"` | `"PAYMENT_FAILED"` |

**Multi-field mapping** — index both ways:

```json
"status_message": {
  "type": "text",
  "fields": {
    "keyword": { "type": "keyword", "ignore_above": 256 }
  }
}
```

Now `status_message` is searchable as full-text and `status_message.keyword` is aggregatable.

### Mapping Explosion (avoid this)

Dynamic mapping on nested JSON can create thousands of fields — exhausts JVM heap. Use `dynamic: false` or `dynamic: strict` on production indexes.

---

## 6. Search — Query DSL

### Query vs Filter Context

```json
GET /orders/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "description": "payment failed" } }
      ],
      "filter": [
        { "term":  { "status": "FAILED" } },
        { "range": { "amount": { "gte": 1000 } } },
        { "range": { "created_at": { "gte": "now-7d/d" } } }
      ]
    }
  }
}
```

**Must (query context):** Contributes to relevance score (`_score`). Slower — must compute TF/IDF or BM25.

**Filter (filter context):** Binary yes/no. No scoring. **Cached** by the query cache. Always put non-relevance conditions in `filter`.

### Common Query Types

```json
// Exact match on keyword
{ "term": { "status": "PAID" } }

// Full-text on text field (BM25 scoring)
{ "match": { "description": "payment gateway timeout" } }

// Phrase match — terms must be adjacent
{ "match_phrase": { "description": "payment gateway" } }

// Multiple terms (OR by default)
{ "terms": { "status": ["PAID", "REFUNDED"] } }

// Wildcard (expensive — avoid on high-cardinality fields)
{ "wildcard": { "order_id": "ord_8*" } }

// Range
{ "range": { "amount": { "gte": 500, "lte": 5000 } } }

// Exists
{ "exists": { "field": "refund_id" } }

// Fuzzy (handles typos)
{ "fuzzy": { "description": { "value": "paymnt", "fuzziness": "AUTO" } } }
```

### Aggregations

Aggregations are analytics on top of search — equivalent to GROUP BY in SQL.

```json
GET /orders/_search
{
  "size": 0,
  "aggs": {
    "by_status": {
      "terms": { "field": "status", "size": 10 },
      "aggs": {
        "total_amount": { "sum": { "field": "amount" } },
        "avg_amount":   { "avg": { "field": "amount" } }
      }
    },
    "orders_over_time": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "day"
      }
    },
    "amount_percentiles": {
      "percentiles": {
        "field": "amount",
        "percents": [50, 95, 99]
      }
    }
  }
}
```

**Important:** Aggregations run on the entire result set (not just the current page). `size: 0` skips returning hits — common pattern when you only need aggregation results.

---

## 7. Relevance Scoring — BM25

OpenSearch/Elasticsearch use **BM25** (Best Match 25) as the default scoring algorithm. It replaced TF-IDF in Elasticsearch 5.0.

```
Score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgDL))

Where:
  f(qi, D)  = term frequency of query term qi in document D
  |D|       = document length
  avgDL     = average document length in the index
  k1        = term frequency saturation (default 1.2) — diminishing returns on repeated terms
  b         = length normalization (default 0.75) — penalizes long documents
  IDF       = log(1 + (N - n + 0.5) / (n + 0.5)) — rare terms score higher
```

**What this means practically:**
- A document mentioning "payment" 10 times scores higher than one mentioning it once — but the gain diminishes (saturation via k1)
- Long documents are penalized relative to short ones (normalization via b)
- Rare terms in the index score higher than common terms (IDF)
- Tune b=0 to disable length normalization (useful for log data)

### Boosting

```json
{
  "bool": {
    "should": [
      { "match": { "title":       { "query": "payment", "boost": 3 } } },
      { "match": { "description": { "query": "payment", "boost": 1 } } }
    ]
  }
}
```

---

## 8. Performance & Production Tuning

### JVM Heap

- Set heap to **50% of available RAM**, max 32 GB (above 32 GB, JVM can't use compressed OOPs — pointer size doubles, heap becomes less efficient)
- Set `Xms = Xmx` — prevents heap resizing at runtime
- Monitor GC pauses — long GC = cluster instability

```bash
# elasticsearch.yml / opensearch.yml
-Xms16g
-Xmx16g
```

### Index Lifecycle Management (ILM) / Index State Management (ISM)

For time-series data (logs, events), use ILM (Elasticsearch) or ISM (OpenSearch) to automate index lifecycle:

```
Hot phase    → Active write + search. Keep on fast SSD nodes.
Warm phase   → Reduced replicas, force-merge to 1 segment, move to warm nodes.
Cold phase   → Read-only, compressed. Move to cold/object storage.
Delete phase → Auto-delete after retention window.
```

This is critical for log use cases. Without it, old indexes pile up and consume expensive SSD storage.

### Force Merge

After a time-series index stops receiving writes, force-merge it to 1 segment:

```
POST /logs-2024-01-01/_forcemerge?max_num_segments=1
```

This removes deleted documents, reduces segment count, and dramatically speeds up searches on that index. Only do this on read-only indexes — force merge on active indexes blocks writes.

### Query Tuning

```
1. Always use filter context for non-scoring conditions (cached)
2. Avoid wildcard/regex on high-cardinality keyword fields
3. Use keyword for sorting, not text
4. Avoid deep pagination — use search_after instead of from/size
5. Use _source filtering to return only needed fields
6. Profile slow queries with ?profile=true
7. Avoid scripted fields in hot paths (Painless scripts bypass query cache)
```

### Deep Pagination Problem

```json
// BAD — from+size has O(from+size) cost per shard, multiplied by shard count
GET /orders/_search
{ "from": 10000, "size": 10 }

// GOOD — search_after uses a cursor (stateless, O(1) per page)
GET /orders/_search
{
  "size": 10,
  "sort": [{ "created_at": "desc" }, { "_id": "asc" }],
  "search_after": ["2024-01-15T10:44:22Z", "ord_8900"]
}
```

`from: 10000` forces each shard to collect and sort 10,010 docs internally, then the coordinating node merges all of them — extremely expensive at scale.

---

## 9. OpenSearch-Specific Features

### k-NN Vector Search

OpenSearch's k-NN plugin enables approximate nearest-neighbor search — the foundation of semantic/vector search and recommendation systems.

```json
PUT /products
{
  "settings": { "index.knn": true },
  "mappings": {
    "properties": {
      "product_name": { "type": "text" },
      "embedding": {
        "type": "knn_vector",
        "dimension": 768,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "lucene",
          "parameters": { "ef_construction": 128, "m": 16 }
        }
      }
    }
  }
}

// Search by vector
GET /products/_search
{
  "query": {
    "knn": {
      "embedding": {
        "vector": [0.12, 0.45, ...],
        "k": 10
      }
    }
  }
}
```

Engines available: `lucene` (pure Java, no native deps), `nmslib` (fast, C++), `faiss` (Meta's library, GPU support).

**HNSW** (Hierarchical Navigable Small World) is the default algorithm — builds a graph of vectors at multiple layers for approximate nearest-neighbor search in O(log N).

### Neural Search (OpenSearch 2.x)

Combines BM25 keyword search with vector search using a hybrid scoring model:

```json
GET /products/_search
{
  "query": {
    "hybrid": {
      "queries": [
        { "match": { "product_name": "wireless headphones" } },
        { "knn": { "embedding": { "vector": [...], "k": 10 } } }
      ]
    }
  },
  "search_pipeline": {
    "phase_results_processors": [{
      "normalization-processor": {
        "normalization": { "technique": "min_max" },
        "combination":   { "technique": "arithmetic_mean", "parameters": { "weights": [0.3, 0.7] } }
      }
    }]
  }
}
```

### ML Commons

OpenSearch's ML framework for running models within the cluster — supports text embedding models, anomaly detection, and custom models via the ML Commons API.

### Security Plugin (Free in OpenSearch)

OpenSearch bundles security features that are paywalled in Elasticsearch:
- TLS encryption (node-to-node + REST)
- Role-based access control (RBAC)
- Field-level security (mask or exclude sensitive fields per role)
- Document-level security (users only see documents matching a query)
- Audit logging
- SAML, OIDC, LDAP integration

```yaml
# opensearch.yml
plugins.security.ssl.transport.enabled: true
plugins.security.ssl.http.enabled: true
plugins.security.allow_default_init_securityindex: true
```

---

## 10. Common Production Patterns

### Write Alias Pattern

Never write directly to an index — always write to an alias. This allows zero-downtime reindexing.

```json
// Create index with version suffix
PUT /orders-v1 { "mappings": { ... } }

// Create alias pointing to it
POST /_aliases
{
  "actions": [
    { "add": { "index": "orders-v1", "alias": "orders", "is_write_index": true } }
  ]
}

// App always writes to alias "orders"
PUT /orders/_doc/ord_891 { ... }

// Reindex to v2 (mapping change)
POST /_reindex
{ "source": { "index": "orders-v1" }, "dest": { "index": "orders-v2" } }

// Atomic alias swap — zero downtime
POST /_aliases
{
  "actions": [
    { "remove": { "index": "orders-v1", "alias": "orders" } },
    { "add":    { "index": "orders-v2", "alias": "orders", "is_write_index": true } }
  ]
}
```

### Log Ingestion Pattern (ELK / EFK Stack)

```
Application logs
    → Filebeat / Fluent Bit        (lightweight log shipper)
    → Logstash / Data Prepper      (parse, enrich, filter)
    → OpenSearch / Elasticsearch   (store, index)
    → OpenSearch Dashboards/Kibana (visualize)
```

For OpenSearch on AWS:
```
Application → CloudWatch Logs → Kinesis Firehose → Amazon OpenSearch Service
```

### Index Template for Time-Series Data

```json
PUT /_index_template/logs-template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "refresh_interval": "5s"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "level":      { "type": "keyword" },
        "service":    { "type": "keyword" },
        "message":    { "type": "text" },
        "trace_id":   { "type": "keyword" }
      }
    }
  },
  "priority": 100
}
```

New indexes matching `logs-*` automatically inherit this template.

---

## 11. Cluster Health & Operations

### Health States

```
Green  → All primary + replica shards assigned and active
Yellow → All primaries active, but some replicas unassigned (data safe, not redundant)
Red    → One or more primary shards unassigned (data loss possible — partial results)
```

```bash
GET /_cluster/health
GET /_cluster/health?level=indices
GET /_cat/shards?v&h=index,shard,prirep,state,node,unassigned.reason
GET /_cat/nodes?v&h=name,heap.percent,ram.percent,cpu,load_1m,node.role
```

### Common Issues

**Unassigned shards (Yellow/Red):**
- Disk watermark exceeded → nodes refuse new shards
- Not enough nodes for replica placement
- Fix: `PUT /_cluster/settings { "transient": { "cluster.routing.allocation.enable": "all" } }`

**High JVM heap:**
- Field data cache bloat from text field aggregations (never aggregate on text)
- Large bulk batches
- Too many shards per node (keep < 20 shards per GB of heap)

**Split brain (historical, prevented in modern versions):**
- Set `minimum_master_nodes = (master_eligible_nodes / 2) + 1`
- In ES 7+ and OpenSearch, Raft-based consensus (cluster.initial_master_nodes) replaces this

**Hot shards:**
- All traffic hitting one shard because of bad partition key (e.g. using a low-cardinality field as routing)
- Fix: custom routing on high-cardinality field, or use `_routing` with multiple shards

---

## 12. Data Modelling Decisions

### Nested vs Flattened vs Parent-Child

**Flat document (preferred):** Denormalize and repeat data. Fastest. Simplest.

```json
{ "order_id": "ord_891", "customer_name": "Swaranshu", "item_name": "Laptop", "item_price": 75000 }
{ "order_id": "ord_891", "customer_name": "Swaranshu", "item_name": "Mouse",  "item_price": 2000 }
```

**Nested objects:** Use when you need to query inner objects as a unit (e.g. "orders where item_name=Laptop AND item_price<80000" for the same item). Stored as hidden documents — expensive to update.

```json
{
  "order_id": "ord_891",
  "items": [
    { "name": "Laptop", "price": 75000 },
    { "name": "Mouse",  "price": 2000 }
  ]
}
```

```json
{ "nested": { "path": "items", "query": {
    "bool": { "must": [
      { "match": { "items.name": "Laptop" } },
      { "range": { "items.price": { "lt": 80000 } } }
    ]}
}}}
```

**Parent-child:** Separate types with a join field. Child documents can be updated without reindexing the parent. Expensive at query time (requires same shard). Use only when relationships change frequently.

**Rule:** Start flat. Move to nested only when you need correlated inner-object queries. Avoid parent-child unless you have a clear update-frequency reason.

---

## 13. Elasticsearch vs OpenSearch — When to Choose Which

### Choose OpenSearch when:
- You're on AWS (deep IAM, VPC, CloudWatch integration via Amazon OpenSearch Service)
- You need security features for free (RBAC, field/document-level, TLS)
- You need vector/semantic search with open tooling
- License compliance is critical (Apache 2.0)
- Budget constraints — no Elastic subscription needed
- You're building a log analytics pipeline on AWS

### Choose Elasticsearch when:
- You need Elastic's proprietary ML models (ELSER for semantic search, Elastic AI Assistant)
- You have an existing Elastic support contract
- You need Elastic APM or Elastic Security (SIEM) as an integrated suite
- Your team has deep Kibana + Elastic Stack expertise
- You need the very latest Lucene features (Elasticsearch ships Lucene upgrades faster)

---

## 14. Tech Lead Interview — Key Talking Points

### Shard Strategy

> "I size shards at 20–40 GB each with a target of 20 shards per GB of JVM heap per node. For time-series data I use daily or monthly indexes with ISM/ILM to roll through hot → warm → cold → delete. I always write through an alias so I can reindex without downtime."

### Relevance vs Performance Tradeoff

> "BM25 is great for keyword relevance. For semantic search, we layer k-NN vector search on top — either as a hybrid query combining BM25 + cosine similarity, or pure vector if the use case is recommendation-style. The tradeoff is that vector indexes (HNSW graphs) consume significant RAM proportional to vector dimension × document count."

### At-Scale Concerns

> "The biggest operational challenges are: shard count explosion on dynamic indexes, JVM heap pressure from fielddata on text fields, hot shard patterns from poor routing keys, and query latency from deep pagination. I instrument with slow query logs, profile API, and node stats dashboards."

### Cluster Topology for Production

```
3 dedicated master-eligible nodes   (t3.medium — lightweight, no data)
N data nodes                        (sized by data volume + query load)
2 coordinating nodes (optional)     (handle search fan-out for heavy query traffic)
1–2 ingest nodes (optional)         (pipeline preprocessing — grok, enrich, etc.)
```

### Reindexing Strategy (Zero Downtime)

> "Versioned index names + alias for write. When schema changes: create v2 index with new mapping → reindex from v1 to v2 via _reindex API → atomic alias swap. Application is insulated from index names entirely — it always writes to and reads from the alias."

### OpenSearch vs Elasticsearch for New Greenfield Project

> "For a new project on AWS, I'd default to OpenSearch — Apache 2.0 license, full security plugin at no cost, deep AWS integration, and k-NN vector search built in for future ML use cases. For an existing Elastic stack or if we need Elastic's proprietary ML, I'd stay on Elasticsearch."

---

## 15. Quick Reference Cheatsheet

```bash
# Cluster
GET /_cluster/health
GET /_cat/nodes?v
GET /_cat/shards?v

# Index management
PUT  /my-index { "settings": {}, "mappings": {} }
GET  /my-index/_mapping
POST /my-index/_forcemerge?max_num_segments=1
POST /_reindex

# Search
GET /my-index/_search { "query": { ... } }
GET /my-index/_search?profile=true    # slow query profiling
GET /my-index/_explain/doc_id { "query": {} }  # why did this doc score X?

# Alias
POST /_aliases { "actions": [ { "add": {} }, { "remove": {} } ] }

# ISM (OpenSearch)
PUT /_plugins/_ism/policies/log-policy { "policy": { ... } }
POST /_plugins/_ism/add/logs-*

# k-NN
GET /products/_search { "query": { "knn": { "embedding": { "vector": [...], "k": 10 } } } }

# Diagnostics
GET /_nodes/stats
GET /_nodes/hot_threads
GET /my-index/_stats
GET /_tasks?actions=*search*&detailed
```

---

## 16. One-Liner Answers for Common Interview Questions

**Q: What is the difference between a shard and a replica?**
A primary shard holds actual data and handles writes; a replica is a copy of a primary that provides redundancy and handles reads. Replicas can be added/removed at runtime; primary shard count is fixed at index creation.

**Q: Why can't you change the number of primary shards after index creation?**
The routing formula `hash(doc_id) % num_primary_shards` hardcodes shard count — changing it would invalidate all existing routing. The workaround is reindexing to a new index with the desired shard count.

**Q: What is near real-time search?**
Documents are searchable ~1 second after indexing — after the next refresh cycle writes the in-memory buffer to a Lucene segment. Not instantly after the write ACK.

**Q: How do you handle mapping conflicts in OpenSearch?**
Use explicit mappings with `dynamic: strict` to reject unmapped fields. For migrations, create a new versioned index and reindex.

**Q: What causes a red cluster?**
One or more primary shards are unassigned — typically disk full (watermark exceeded), node loss without enough nodes to re-place primaries, or shard corruption.

**Q: text vs keyword?**
`text` = analyzed, full-text searchable, not aggregatable. `keyword` = exact match, filterable, aggregatable, sortable. Use multi-field mapping to get both.

**Q: How is OpenSearch different from Elasticsearch for a tech lead?**
License (Apache 2.0 vs SSPL/AGPL), governance (community vs Elastic), free security plugin in OpenSearch, AWS-native integration, k-NN vector search built in. API ~95% compatible at the 7.10 baseline.

