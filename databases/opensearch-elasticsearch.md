---
title: "OpenSearch & Elasticsearch"
description: "Tech Lead interview guide — architecture, indexing, Query DSL, BM25 scoring, k-NN vector search, production tuning, and the OpenSearch vs Elasticsearch decision framework."
order: 2
---

# OpenSearch & Elasticsearch

> **Category:** Distributed Search & Analytics · **Difficulty:** Advanced · **Related:** Lucene · Kafka · Distributed Systems

---

## 01 — What They Are & How They Relate

**Elasticsearch** is a distributed search and analytics engine built on Apache Lucene — the industry standard for full-text search, log analytics, and real-time data exploration.

**OpenSearch** is a community-driven, Apache 2.0 fork of Elasticsearch 7.10.2, created by AWS in 2021 after Elastic relicensed under SSPL — which is not OSI-approved open source.

```
Elasticsearch (Apache 2.0)
    └── versions up to 7.10.2
    └── forked by AWS → OpenSearch 1.0  (Sept 2021)

Elasticsearch (SSPL → AGPL in 2024)
    └── versions 7.11+ onward
    └── continues independently under Elastic
```

> **The fork moment:** In January 2021, Elastic relicensed under SSPL. AWS forked version 7.10.2 and released OpenSearch 1.0. APIs were kept deliberately compatible (~95% at the 7.10 baseline). As of 2024, OpenSearch is at 2.x with significant additions — k-NN vector search, ML Commons, free security plugin.

---

## 02 — Architecture Deep Dive

### Core Concepts

| Concept | Description |
|---|---|
| **Index** | Equivalent to a database table — a collection of documents sharing a mapping |
| **Document** | A JSON object — the unit of storage and retrieval |
| **Shard** | A single Lucene instance — an index is split into N primary shards for horizontal scale |
| **Replica** | A copy of a primary shard — provides redundancy and read throughput |
| **Node** | A single server in the cluster — roles: master, data, ingest, coordinating |
| **Segment** | Immutable Lucene file on disk — shards are made of segments |
| **Inverted Index** | The core data structure — maps terms → document IDs for fast full-text lookup |

### Node Roles

```
Cluster
├── Master-eligible nodes   (cluster state management, index creation, shard allocation)
├── Data nodes              (store shards, handle CRUD + search on local shards)
├── Ingest nodes            (pre-process docs via pipelines before indexing)
├── Coordinating nodes      (route requests, scatter-gather search results)
└── ML nodes (OpenSearch)   (run ML models, anomaly detection)
```

> **Production rule:** Always dedicate master-eligible nodes — never let data nodes be master-eligible on large clusters. 3 master-eligible nodes is the standard minimum.

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

**Shard sizing rule of thumb:** Keep shards between **10–50 GB**. Too small = overhead. Too large = slow recovery and GC pressure.

### The Inverted Index (Lucene)

When you index a document, text is analyzed (tokenized, lowercased, stemmed) and stored as:

```
Term        → Document IDs
"payment"   → [doc_1, doc_4, doc_9]
"order"     → [doc_1, doc_2, doc_7]
"failed"    → [doc_4, doc_9]
```

A search for `"payment failed"` becomes an intersection of posting lists — extremely fast even over billions of documents.

---

## 03 — Elasticsearch vs OpenSearch

### Key Differences

| Area | Elasticsearch | OpenSearch |
|---|---|---|
| **License** | SSPL (7.11+), AGPL (8.9+) | Apache 2.0 |
| **Governance** | Elastic (company) | OpenSearch Project (community + AWS) |
| **Managed cloud** | Elastic Cloud | Amazon OpenSearch Service |
| **Vector search** | kNN via `dense_vector` | k-NN plugin — FAISS, Nmslib, Lucene engine |
| **ML features** | Elastic ML (RLHF, ELSER) | ML Commons, neural search |
| **Security** | X-Pack (paid tier historically) | Security plugin — **free, bundled** |
| **Kibana equivalent** | Kibana | OpenSearch Dashboards |
| **Logstash equivalent** | Logstash | Data Prepper |
| **API compatibility** | Reference implementation | ~95% compatible with ES 7.10 API |
| **Alerting** | Watcher (paid) | Alerting plugin (free) |

> **Tech lead note:** On AWS infrastructure, OpenSearch Service is the natural choice — no licensing concern, deep IAM/VPC/CloudWatch integration. If you need Elastic's proprietary ML models (ELSER for semantic search) or an Elastic support contract, stay on Elasticsearch.

---

## 04 — Indexing — How Documents Get Stored

### Write Path in Detail

```
1. Client sends PUT /orders/_doc/ord_891 { "status": "PAID", "amount": 2400 }
2. Request hits coordinating node
3. Coordinating node computes: shard = hash(ord_891) % num_primary_shards
4. Request forwarded to primary shard's node
5. Primary shard writes to in-memory buffer + translog (WAL equivalent)
6. Primary forwards to replica shards in parallel
7. Once majority replicas ACK → client gets 200 OK
8. Background: refresh (every 1s) writes buffer → new Lucene segment (now searchable)
9. Background: flush (every 30min or translog threshold) → fsync to disk, clear translog
```

### Refresh vs Flush vs Merge

| Operation | What it does | Durability | Cost |
|---|---|---|---|
| **Refresh** (every 1s) | Buffer → new Lucene segment — docs become searchable | ❌ Not fsynced | Moderate |
| **Flush** (auto or API) | fsync segments to disk, clear translog | ✅ Durable | High I/O |
| **Segment Merge** (background) | Combines small segments, removes deleted docs | — | High CPU + I/O |

> **Interview answer:** "Near real-time" means documents are searchable within ~1 second — after the next refresh cycle. Not instantly after the write ACK. You can force `?refresh=true` or `?refresh=wait_for` but at a performance cost.

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
- Use bulk API with **5–15 MB** batches
- Use multiple parallel bulk threads (match data node count)

---

## 05 — Mappings & Data Types

Always define **explicit mappings** in production. Dynamic mapping is convenient but dangerous at scale — it can silently create wrong field types and cause mapping explosion.

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
      "created_at":  { "type": "date", "format": "strict_date_optional_time" },
      "embedding":   { "type": "knn_vector", "dimension": 768 }
    }
  }
}
```

### `text` vs `keyword` — The Most Common Interview Question

| | `text` | `keyword` |
|---|---|---|
| **Use for** | Full-text search (descriptions, messages) | Exact match, filtering, aggregations, sorting |
| **Analyzed?** | Yes — tokenized, lowercased, stemmed | No — stored as-is |
| **Aggregatable?** | ❌ No | ✅ Yes |
| **Example value** | `"Payment failed for order"` | `"PAYMENT_FAILED"` |

**Multi-field mapping** — index both ways for maximum flexibility:

```json
"status_message": {
  "type": "text",
  "fields": {
    "keyword": { "type": "keyword", "ignore_above": 256 }
  }
}
```

Now `status_message` is full-text searchable and `status_message.keyword` is aggregatable.

> **Mapping explosion warning:** Dynamic mapping on deeply nested JSON can create thousands of fields and exhaust JVM heap. Use `dynamic: false` or `dynamic: strict` on production indexes.

---

## 06 — Search — Query DSL

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

| Context | Behaviour | Performance |
|---|---|---|
| **must** (query context) | Contributes to `_score` — computes BM25 relevance | Slower |
| **filter** (filter context) | Binary yes/no — no scoring | **Cached** — always prefer for non-relevance conditions |

### Common Query Types

```json
// Exact match on keyword
{ "term": { "status": "PAID" } }

// Full-text on text field (BM25 scoring)
{ "match": { "description": "payment gateway timeout" } }

// Phrase match — terms must be adjacent
{ "match_phrase": { "description": "payment gateway" } }

// Multiple terms (OR)
{ "terms": { "status": ["PAID", "REFUNDED"] } }

// Range
{ "range": { "amount": { "gte": 500, "lte": 5000 } } }

// Fuzzy (handles typos — AUTO = edit distance based on term length)
{ "fuzzy": { "description": { "value": "paymnt", "fuzziness": "AUTO" } } }

// Wildcard (expensive — avoid on high-cardinality fields)
{ "wildcard": { "order_id": "ord_8*" } }
```

### Aggregations

Aggregations are analytics on top of search — equivalent to `GROUP BY` in SQL.

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
    }
  }
}
```

> **Key pattern:** `size: 0` skips returning hits — use it when you only need aggregation results. Aggregations run over the **entire** result set, not just the current page.

---

## 07 — Relevance Scoring — BM25

OpenSearch/Elasticsearch use **BM25** (Best Match 25) as the default scoring algorithm, replacing TF-IDF since Elasticsearch 5.0.

```
Score(D, Q) = Σ IDF(qi) × (f(qi,D) × (k1+1)) / (f(qi,D) + k1 × (1 - b + b × |D|/avgDL))

Where:
  f(qi, D)  = term frequency of query term in document D
  |D|       = document length
  avgDL     = average document length in the index
  k1 = 1.2  = term frequency saturation (diminishing returns on repeated terms)
  b  = 0.75 = length normalization (penalizes long documents)
  IDF       = log(1 + (N - n + 0.5) / (n + 0.5)) — rare terms score higher
```

**What this means practically:**
- Mentioning "payment" 10× scores higher than once — but gains diminish (k1 saturation)
- Long documents are penalized relative to short ones (b normalization)
- Rare terms score higher than common terms (IDF)
- Set `b=0` to disable length normalization — useful for log data where document length shouldn't matter

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

## 08 — Performance & Production Tuning

### JVM Heap Rules

- Set heap to **50% of available RAM**, hard max **32 GB** — above 32 GB, JVM loses compressed OOPs and pointer size doubles
- Always set `Xms = Xmx` — prevents heap resizing at runtime
- Keep **< 20 shards per GB of heap** per node
- Monitor GC pauses — sustained GC = cluster instability

```bash
# jvm.options
-Xms16g
-Xmx16g
```

### Index Lifecycle Management (ILM / ISM)

For time-series data (logs, events), automate the full lifecycle:

| Phase | Action |
|---|---|
| **Hot** | Active writes + search. Fast SSD nodes. |
| **Warm** | Reduce replicas, force-merge to 1 segment. Move to warm nodes. |
| **Cold** | Read-only, compressed. Move to cold/object storage. |
| **Delete** | Auto-delete after retention window. |

> Without ILM/ISM, old indexes pile up and consume expensive SSD storage. This is non-negotiable for any log pipeline.

### Deep Pagination Problem

```json
// ❌ BAD — from+size has O(from+size) cost per shard, multiplied by shard count
GET /orders/_search
{ "from": 10000, "size": 10 }

// ✅ GOOD — search_after uses a cursor (stateless, O(1) per page)
GET /orders/_search
{
  "size": 10,
  "sort": [{ "created_at": "desc" }, { "_id": "asc" }],
  "search_after": ["2024-01-15T10:44:22Z", "ord_8900"]
}
```

`from: 10000` forces each shard to collect and sort 10,010 docs, then the coordinating node merges all of them — extremely expensive at scale.

### Query Tuning Checklist

- Always use **filter context** for non-scoring conditions (cached, binary)
- Avoid `wildcard` / `regex` on high-cardinality keyword fields
- Use `keyword` for sorting, not `text`
- Use `_source` filtering to return only needed fields
- Profile slow queries with `?profile=true`
- Avoid Painless scripted fields in hot paths — they bypass the query cache

---

## 09 — OpenSearch-Specific Features

### k-NN Vector Search

OpenSearch's k-NN plugin enables approximate nearest-neighbor search — the foundation of semantic search and recommendation systems.

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
```

```json
GET /products/_search
{
  "query": {
    "knn": {
      "embedding": { "vector": [0.12, 0.45, "..."], "k": 10 }
    }
  }
}
```

**Engines available:**
- `lucene` — pure Java, no native deps, easiest to run
- `nmslib` — fast, C++ implementation
- `faiss` — Meta's library, GPU support for massive scale

**HNSW** (Hierarchical Navigable Small World) builds a multi-layer graph of vectors for approximate nearest-neighbor search in O(log N). Vector indexes consume significant RAM proportional to `dimension × document_count`.

### Hybrid Search (Neural Search — OpenSearch 2.x)

Combines BM25 keyword search with vector search using a pipeline:

```json
GET /products/_search
{
  "query": {
    "hybrid": {
      "queries": [
        { "match": { "product_name": "wireless headphones" } },
        { "knn": { "embedding": { "vector": ["..."], "k": 10 } } }
      ]
    }
  },
  "search_pipeline": {
    "phase_results_processors": [{
      "normalization-processor": {
        "normalization": { "technique": "min_max" },
        "combination": {
          "technique": "arithmetic_mean",
          "parameters": { "weights": [0.3, 0.7] }
        }
      }
    }]
  }
}
```

### Free Security Plugin

OpenSearch bundles features that are paywalled in Elasticsearch:
- TLS encryption (node-to-node + REST)
- Role-based access control (RBAC)
- Field-level and document-level security
- Audit logging
- SAML, OIDC, LDAP integration

---

## 10 — Production Patterns

### Write Alias Pattern (Zero-Downtime Reindexing)

Never write directly to an index — always write to an **alias**:

```json
// 1. Create versioned index
PUT /orders-v1 { "mappings": { "..." } }

// 2. Create alias pointing to it
POST /_aliases
{ "actions": [{ "add": { "index": "orders-v1", "alias": "orders", "is_write_index": true } }] }

// 3. App always writes to alias "orders" — index name is hidden

// 4. When schema changes: reindex to v2
POST /_reindex
{ "source": { "index": "orders-v1" }, "dest": { "index": "orders-v2" } }

// 5. Atomic alias swap — zero downtime
POST /_aliases
{
  "actions": [
    { "remove": { "index": "orders-v1", "alias": "orders" } },
    { "add":    { "index": "orders-v2", "alias": "orders", "is_write_index": true } }
  ]
}
```

### Log Ingestion Pipeline

```
Application logs
    → Filebeat / Fluent Bit        (lightweight shipper)
    → Logstash / Data Prepper      (parse, enrich, filter)
    → OpenSearch / Elasticsearch   (store, index)
    → Dashboards / Kibana          (visualize)

On AWS:
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

## 11 — Cluster Health & Operations

### Health States

| State | Meaning |
|---|---|
| 🟢 **Green** | All primary + replica shards assigned and active |
| 🟡 **Yellow** | All primaries active, but some replicas unassigned — data safe, not redundant |
| 🔴 **Red** | One or more primary shards unassigned — data loss possible, partial results returned |

```bash
GET /_cluster/health
GET /_cat/shards?v&h=index,shard,prirep,state,node,unassigned.reason
GET /_cat/nodes?v&h=name,heap.percent,ram.percent,cpu,load_1m,node.role
```

### Common Issues & Fixes

- **Unassigned shards (Yellow/Red):** Disk watermark exceeded — nodes refuse new shards. Fix: free disk space or `PUT /_cluster/settings { "transient": { "cluster.routing.allocation.enable": "all" } }`
- **High JVM heap:** Field data cache bloat from `text` field aggregations (never aggregate on `text`). Too many shards per node.
- **Hot shards:** Low-cardinality routing key concentrates traffic on one shard. Fix: route on a high-cardinality field.
- **Split brain (modern versions):** Prevented by Raft-based consensus (`cluster.initial_master_nodes` in ES 7+ / OpenSearch).

---

## 12 — Data Modelling Decisions

### Nested vs Flat vs Parent-Child

| Model | When to use | Cost |
|---|---|---|
| **Flat (preferred)** | Denormalize and repeat data — fastest and simplest | None |
| **Nested objects** | Need correlated inner-object queries (e.g. `item.name=Laptop AND item.price<80k` for the **same** item) | Expensive updates — stored as hidden docs |
| **Parent-child** | Child documents change frequently without reindexing the parent | Expensive at query time — requires same shard co-location |

> **Rule:** Start flat. Move to nested only when you need correlated inner-object queries. Avoid parent-child unless update frequency explicitly demands it.

---

## 13 — When to Choose Which

### ✅ Choose OpenSearch when:
- You're on AWS — deep IAM, VPC, CloudWatch integration via Amazon OpenSearch Service
- You need security features for free (RBAC, field/document-level, TLS, audit logging)
- License compliance is critical — Apache 2.0 with no restrictions
- You need vector/semantic search with open tooling (k-NN + ML Commons)
- You're building a log analytics pipeline on AWS

### ✅ Choose Elasticsearch when:
- You need Elastic's proprietary ML models (ELSER for semantic search, Elastic AI Assistant)
- You have an existing Elastic support contract
- You need Elastic APM or Elastic Security (SIEM) as an integrated suite
- Your team has deep Kibana + Elastic Stack expertise
- You need the very latest Lucene features — Elasticsearch ships Lucene upgrades faster

---

## 14 — Interview Talking Points

### On Shard Strategy

> "I size shards at 20–40 GB each, targeting 20 shards per GB of JVM heap per node. For time-series data I use daily or monthly indexes with ISM/ILM to roll through hot → warm → cold → delete. I always write through an alias so I can reindex without downtime."

### On Relevance vs Performance

> "BM25 is great for keyword relevance. For semantic search, I layer k-NN vector search on top — either as a hybrid query combining BM25 + cosine similarity, or pure vector for recommendation-style use cases. The tradeoff is that HNSW graphs consume significant RAM proportional to vector dimension × document count."

### On At-Scale Concerns

> "The biggest operational challenges are: shard count explosion on dynamic indexes, JVM heap pressure from fielddata on text fields, hot shard patterns from poor routing keys, and query latency from deep pagination. I instrument with slow query logs, the profile API, and node stats dashboards."

### On Production Cluster Topology

```
3 dedicated master-eligible nodes   (lightweight — t3.medium, no data)
N data nodes                        (sized by data volume + query load)
2 coordinating nodes (optional)     (handle search fan-out for heavy traffic)
1–2 ingest nodes (optional)         (pipeline preprocessing — grok, enrich)
```

---

## 15 — Quick Reference Cheatsheet

```bash
# Cluster health
GET /_cluster/health
GET /_cat/nodes?v
GET /_cat/shards?v

# Index management
PUT  /my-index { "settings": {}, "mappings": {} }
GET  /my-index/_mapping
POST /my-index/_forcemerge?max_num_segments=1
POST /_reindex { "source": { "index": "v1" }, "dest": { "index": "v2" } }

# Alias management
POST /_aliases { "actions": [{ "add": {} }, { "remove": {} }] }

# Search & debug
GET /my-index/_search { "query": { ... } }
GET /my-index/_search?profile=true        # slow query profiling
GET /my-index/_explain/<doc_id> { "query": {} }  # why did this doc score X?

# Diagnostics
GET /_nodes/stats
GET /_nodes/hot_threads
GET /_tasks?actions=*search*&detailed

# ISM (OpenSearch)
PUT /_plugins/_ism/policies/log-policy { "policy": { ... } }

# k-NN
GET /products/_search
{ "query": { "knn": { "embedding": { "vector": [...], "k": 10 } } } }
```

---

## 16 — Interview Summary

> "OpenSearch and Elasticsearch are both distributed search engines built on Lucene. The key differences for a tech lead are license (Apache 2.0 vs SSPL/AGPL), governance, and the fact that OpenSearch bundles a full security plugin for free and has deep AWS integration. At the core, both use an inverted index for full-text search and BM25 for relevance scoring. The critical operational concepts are: shard sizing for performance, the refresh/flush cycle for near-real-time semantics, filter context caching for query speed, alias-based reindexing for zero-downtime schema migrations, and ILM/ISM for cost-effective time-series data management."
