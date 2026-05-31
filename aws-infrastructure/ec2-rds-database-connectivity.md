---
title: "EC2 ↔ RDS — Backend-to-Database Connectivity and Security"
description: "Connection strings, subnet groups, security group chaining, connection pooling, credentials management, and production database patterns."
order: 8
---

# EC2 ↔ RDS — Backend-to-Database Connectivity and Security

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate-Advanced · **Related:** RDS · MySQL · PostgreSQL · Connection Pooling · Secrets Manager

---

## 01 — TL;DR

- RDS is AWS's managed relational database — AWS handles patching, backups, and replication; you handle schema and queries
- Your EC2 backend connects to RDS via a **private DNS endpoint** that resolves to a private IP — traffic never leaves the AWS network
- **Security Group chaining** is the critical pattern: EC2 SG → RDS SG referencing EC2's SG ID (not IP addresses)
- Connection pooling is non-negotiable in production — opening a connection per request adds ~50ms overhead and exhausts database connections under load
- Credentials should live in **AWS Secrets Manager** (with automatic rotation), never in code or plain environment variables
- Multi-AZ deployments provide automatic failover in 60-120 seconds with zero connection string changes
- Always encrypt at rest (AES-256) and in transit (SSL/TLS) — it's free and there's no reason not to

**Why this matters:** The backend-to-database connection is your application's lifeline. Get the security wrong and you get breached. Get the performance wrong and your app crashes under load. Get the networking wrong and nothing works at all.

---

## 02 — What is RDS?

### Managed vs Self-Managed

**RDS (Relational Database Service)** = AWS runs the database infrastructure; you focus on your data.

| Responsibility | RDS (AWS handles) | Self-managed (you on EC2) |
|----------------|-------------------|---------------------------|
| Hardware provisioning | ✅ AWS | ❌ You |
| OS patching | ✅ AWS | ❌ You |
| Database patching | ✅ AWS | ❌ You |
| Automated backups | ✅ AWS | ❌ You (cron + mysqldump?) |
| Multi-AZ failover | ✅ AWS (one checkbox) | ❌ You (weeks of work) |
| Monitoring | ✅ Built-in | ❌ You (install Prometheus?) |
| Scaling storage | ✅ AWS (auto-scaling) | ❌ You (downtime to resize) |
| Schema design | ❌ You | ❌ You |
| Query optimization | ❌ You | ❌ You |
| Connection management | ❌ You | ❌ You |
| Security groups | ❌ You | ❌ You |

### Why Not Install MySQL on EC2?

```
"Just install MySQL on my EC2 instance" — The junior developer's first instinct

Problems:
1. ❌ Server crashes → database gone (unless you set up replication yourself)
2. ❌ Need to patch MySQL security vulnerabilities yourself
3. ❌ No automated backups (hope you wrote that cron job correctly)
4. ❌ Want to scale? Good luck migrating a running database
5. ❌ EBS volume fills up at 3 AM? You're getting paged
6. ❌ Want failover? Build your own with streaming replication

RDS gives you all of this with a few clicks and ~$15/month (db.t3.micro).
```

### Supported Engines

| Engine | Use Case | Free Tier |
|--------|----------|-----------|
| MySQL | Most web apps, WordPress | ✅ db.t3.micro, 750h/mo |
| PostgreSQL | Complex queries, GIS, JSON | ✅ db.t3.micro, 750h/mo |
| MariaDB | MySQL fork, some improvements | ✅ db.t3.micro, 750h/mo |
| Oracle | Enterprise legacy | ❌ |
| SQL Server | .NET shops | Limited |
| Aurora (MySQL/PG) | High performance, auto-scaling | ❌ |

---

## 03 — RDS Instance Classes

### Instance Types

| Class | Type | vCPU | RAM | Use Case |
|-------|------|------|-----|----------|
| db.t3.micro | Burstable | 2 | 1 GB | Free tier, dev/test |
| db.t3.small | Burstable | 2 | 2 GB | Small production apps |
| db.t3.medium | Burstable | 2 | 4 GB | Medium traffic apps |
| db.r5.large | Memory-optimized | 2 | 16 GB | Read-heavy workloads |
| db.r5.xlarge | Memory-optimized | 4 | 32 GB | Large production DBs |
| db.m5.large | General purpose | 2 | 8 GB | Balanced workloads |

### Burstable Performance (T3 Instances)

```
CPU Credits System:
  - You earn credits when CPU usage is below baseline (20% for t3.micro)
  - You spend credits when CPU usage exceeds baseline
  - Credits deplete under sustained high load → performance drops

  Normal:  ████░░░░░░░░░░░░ 20% (earning credits)
  Burst:   ████████████████ 100% (spending credits)  
  Depleted: ████░░░░░░░░░░░░ 20% (throttled, no credits left)

⚠️ For production with consistent load, use non-burstable (m5, r5) instances.
   T3 is fine for dev/test or apps with spiky but mostly idle traffic.
```

### Storage Types

| Type | IOPS | Latency | Cost | Use Case |
|------|------|---------|------|----------|
| gp2 | 3 IOPS/GB (burst to 3000) | ~5ms | $ | Default, most workloads |
| gp3 | 3000 baseline (configurable) | ~3ms | $ | Better than gp2 (newer) |
| io1/io2 | Up to 64,000 | ~1ms | $$$ | High-performance OLTP |
| Magnetic | Low | High | Cheapest | ❌ Legacy, don't use |

> **What is IOPS?** Input/Output Operations Per Second. Each database query involves reads/writes to disk. IOPS = how many of those can happen per second. A typical web app needs 100-3000 IOPS. A high-traffic app might need 10,000+.

---

## 04 — How Your Backend Connects

### Connection String Anatomy

```
postgresql://username:password@hostname:port/database_name
             ────┬───  ──┬──── ───┬──── ─┬── ─────┬──────
                 │        │        │      │        │
           DB user  DB password  RDS     Port   Database
                                endpoint (5432   name
                                (DNS)    PG,
                                         3306
                                         MySQL)
```

### The RDS Endpoint

When you create an RDS instance, AWS gives you a **DNS endpoint**:

```
mydb-instance.c9akzq7wgh2l.us-east-1.rds.amazonaws.com
└─── your name ──┘└─── random ──────┘└── region ─────┘
```

This DNS name resolves to a **private IP** within your VPC:

```bash
# From your EC2 instance (same VPC)
$ nslookup mydb-instance.c9akzq7wgh2l.us-east-1.rds.amazonaws.com
Address: 10.0.3.47    # Private IP in your database subnet
```

### Why This Connection Never Leaves AWS

```
┌─────────────────────── YOUR VPC (10.0.0.0/16) ─────────────────────────┐
│                                                                          │
│  ┌─── Public Subnet (10.0.1.0/24) ────┐  ┌─── Private Subnet ────────┐ │
│  │                                      │  │    (10.0.3.0/24)          │ │
│  │  EC2 Instance                        │  │                           │ │
│  │  10.0.1.50                           │  │    RDS Instance           │ │
│  │  ┌──────────────┐                   │  │    10.0.3.47              │ │
│  │  │  Your App    │                   │  │    ┌──────────────┐       │ │
│  │  │  (Node.js)   │───── port 5432 ───│──│───►│  PostgreSQL  │       │ │
│  │  │              │    PRIVATE NETWORK │  │    │              │       │ │
│  │  └──────────────┘                   │  │    └──────────────┘       │ │
│  │                                      │  │                           │ │
│  └──────────────────────────────────────┘  └───────────────────────────┘ │
│                                                                          │
│  Traffic stays within VPC — never touches the internet                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 05 — Subnet Groups

### Why RDS Needs Multiple Subnets

Even for a **single-AZ** RDS deployment, AWS requires a **DB Subnet Group** with subnets in at least 2 Availability Zones.

**Why?** Because if you ever enable Multi-AZ failover in the future, AWS needs to know which subnet in another AZ to place the standby. It's forward planning.

```
┌──────────────── VPC ────────────────────────────────────┐
│                                                          │
│  AZ us-east-1a              AZ us-east-1b               │
│  ┌───────────────────┐     ┌───────────────────┐       │
│  │ Private Subnet A   │     │ Private Subnet B   │       │
│  │ 10.0.3.0/24        │     │ 10.0.4.0/24        │       │
│  │                     │     │                     │       │
│  │  ┌──────────────┐  │     │  ┌──────────────┐  │       │
│  │  │ RDS Primary  │  │     │  │ RDS Standby  │  │       │
│  │  │ (active)     │──│─────│─►│ (Multi-AZ)   │  │       │
│  │  └──────────────┘  │     │  └──────────────┘  │       │
│  │                     │     │    (sync repl)     │       │
│  └───────────────────┘     └───────────────────┘       │
│                                                          │
│  DB Subnet Group = [Subnet A, Subnet B]                  │
└──────────────────────────────────────────────────────────┘
```

### Creating a DB Subnet Group

```bash
# AWS CLI
aws rds create-db-subnet-group \
  --db-subnet-group-name my-db-subnets \
  --db-subnet-group-description "Private subnets for RDS" \
  --subnet-ids subnet-0a1b2c3d subnet-4e5f6g7h

# These subnets MUST be:
# 1. In at least 2 different AZs
# 2. Private (no internet gateway route)
# 3. Have enough free IPs for RDS instances
```

---

## 06 — Security Group Chaining

### THE Critical Pattern

This is the #1 most important networking concept for RDS security:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  EC2 Security Group (sg-ec2-app)                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Inbound: port 443 from 0.0.0.0/0 (HTTPS from internet) │    │
│  │ Outbound: port 5432 to sg-rds-db  ← REFERENCE BY SG ID │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  RDS Security Group (sg-rds-db)                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Inbound: port 5432 from sg-ec2-app ← REFERENCE BY SG ID│    │
│  │ Outbound: (none needed for RDS)                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ❌ BAD: Inbound port 5432 from 10.0.1.50/32 (IP changes!)     │
│  ✅ GOOD: Inbound port 5432 from sg-ec2-app (SG ID is stable)  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Why SG-Based Rules Beat IP-Based Rules

| Approach | Pros | Cons |
|----------|------|------|
| IP-based (`10.0.1.50/32`) | Simple to understand | ❌ IP changes on EC2 restart (unless Elastic IP) |
| | | ❌ Auto Scaling gives new IPs → must update rules |
| | | ❌ Doesn't scale (max 60 rules per SG) |
| SG-based (`sg-ec2-app`) | ✅ Works regardless of IP | More abstract concept |
| | ✅ Auto Scaling instances auto-included | |
| | ✅ Scales to any number of EC2 instances | |
| | ✅ Self-documenting ("only my app can connect") | |

> **Interview Callout:** "How would you securely connect an application to a database in AWS? Walk me through the networking."
>
> **Model answer:** "The RDS instance lives in a private subnet with no internet access. The EC2 application server connects via the RDS endpoint (a private DNS name). The RDS security group only allows inbound traffic on the database port (5432 for Postgres) from the EC2 instance's security group ID — not from specific IPs. This means even if IP addresses change (auto-scaling, instance replacement), the access rules remain valid. The connection uses SSL/TLS for encryption in transit, and credentials are stored in AWS Secrets Manager with automatic rotation."

---

## 07 — Connection Pooling

### Why Opening a Connection Per Request is Terrible

```
WITHOUT CONNECTION POOLING:

Request 1: [DNS lookup 5ms][TCP handshake 1ms][TLS handshake 10ms][Auth 5ms][Query 2ms][Close]
Request 2: [DNS lookup 5ms][TCP handshake 1ms][TLS handshake 10ms][Auth 5ms][Query 2ms][Close]
Request 3: [DNS lookup 5ms][TCP handshake 1ms][TLS handshake 10ms][Auth 5ms][Query 2ms][Close]

Total overhead per request: ~21ms (query itself was only 2ms!)
Under 500 concurrent requests: 500 simultaneous connections → RDS max is typically 66-150!

WITH CONNECTION POOLING:

App start: [Create 10 connections — keep them alive]

Request 1: [Borrow connection][Query 2ms][Return to pool]
Request 2: [Borrow connection][Query 2ms][Return to pool]  
Request 3: [Borrow connection][Query 2ms][Return to pool]

Total overhead per request: ~0ms (connection already established!)
Under 500 concurrent requests: 10-20 pool connections handle it all via queuing
```

### Max Connections by Instance Size

| Instance | RAM | Default max_connections |
|----------|-----|----------------------|
| db.t3.micro | 1 GB | ~66 |
| db.t3.small | 2 GB | ~150 |
| db.t3.medium | 4 GB | ~312 |
| db.r5.large | 16 GB | ~1200 |
| db.r5.xlarge | 32 GB | ~2500 |

Formula: `max_connections ≈ RAM(bytes) / 9531392`

### Pool Configuration (Node.js with pg-pool)

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,           // RDS endpoint
  port: 5432,
  database: 'myapp',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: true },   // Always use SSL!
  
  // Pool configuration
  min: 5,                // Minimum idle connections (keep warm)
  max: 20,              // Maximum total connections
  idleTimeoutMillis: 30000,    // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail if can't get connection in 5s
  maxUses: 7500,        // Close connection after N uses (prevent memory leaks)
});

// Usage in request handler
app.get('/api/users/:id', async (req, res) => {
  const client = await pool.connect();  // Borrow from pool
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } finally {
    client.release();  // ALWAYS return to pool (even on error!)
  }
});

// Monitor pool health
setInterval(() => {
  console.log({
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingRequests: pool.waitingCount,  // ⚠️ If this grows, increase max
  });
}, 10000);
```

### Pool Sizing Guidelines

```
Optimal pool size = (Number of physical CPU cores on DB * 2) + number of disks

For db.t3.small (2 vCPU, 1 disk): (2 * 2) + 1 = 5 connections per app instance

If you have 4 app instances: 5 * 4 = 20 total connections (well under max_connections)

⚠️ COMMON MISTAKE: Setting pool max to 100 per instance with 10 instances
   = 1000 connections → exceeds RDS max → "too many connections" error at 3 AM
```

> **⚠️ What would go wrong if...** you had no connection pooling under load?
> At 500 concurrent requests, your app tries to open 500 database connections. RDS max_connections for db.t3.micro is ~66. Connection 67 gets "FATAL: too many connections." Your entire application crashes. With a pool of 20 connections, those 500 requests queue up and get served in ~200ms instead of crashing.

---

## 08 — Credentials Management

### The Evolution of Credentials Security

```
Level 0 — Hardcoded (❌ NEVER DO THIS)
─────────────────────────────────────────
const pool = new Pool({
  host: 'mydb.c9akzq7wgh2l.us-east-1.rds.amazonaws.com',
  password: 'SuperSecret123!'  // ❌ In source code, in Git history FOREVER
});

Level 1 — Environment Variables (✅ Minimum acceptable)
─────────────────────────────────────────
// .env file (added to .gitignore!)
DB_PASSWORD=SuperSecret123!

const pool = new Pool({
  password: process.env.DB_PASSWORD  // ✅ Not in code
});
// ⚠️ Still risks: env vars in logs, process listings, CI/CD configs

Level 2 — AWS Secrets Manager (✅✅ Production standard)
─────────────────────────────────────────
// Secret stored in AWS, fetched at runtime, auto-rotated
const password = await getSecret('prod/myapp/db-credentials');

Level 3 — IAM Database Authentication (✅✅✅ Best for AWS-native)
─────────────────────────────────────────
// No password at all! Short-lived token from IAM role
const token = await generateRdsAuthToken();
// Token valid for 15 minutes, auto-generated from EC2 instance role
```

---

## 09 — AWS Secrets Manager

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  1. You store the secret in Secrets Manager                       │
│     Secret Name: prod/myapp/db-credentials                       │
│     Value: {"username":"admin","password":"xK9#mP2...","host":"..."} │
│                                                                   │
│  2. Your app fetches the secret at startup                       │
│     EC2 (IAM role) → Secrets Manager API → Returns secret value  │
│                                                                   │
│  3. (Optional) Automatic rotation every 30 days                  │
│     Secrets Manager → Lambda function → Updates RDS password     │
│     → Stores new password → Your app fetches new value           │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Complete Implementation

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { Pool } = require('pg');

const secretsClient = new SecretsManagerClient({ region: 'us-east-1' });

let pool = null;

async function getDbCredentials() {
  const command = new GetSecretValueCommand({
    SecretId: 'prod/myapp/db-credentials',
  });
  
  const response = await secretsClient.send(command);
  return JSON.parse(response.SecretString);
  // Returns: { username, password, host, port, dbname }
}

async function getPool() {
  if (!pool) {
    const creds = await getDbCredentials();
    pool = new Pool({
      host: creds.host,
      port: creds.port,
      database: creds.dbname,
      user: creds.username,
      password: creds.password,
      ssl: { rejectUnauthorized: true },
      min: 5,
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// Handle secret rotation (pool reconnection)
async function refreshPool() {
  if (pool) {
    await pool.end();  // Close old connections
    pool = null;
  }
  return getPool();  // Create new pool with fresh credentials
}

// Usage
app.get('/api/users', async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.query('SELECT * FROM users LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    if (err.code === '28P01') {  // Invalid password (rotated?)
      await refreshPool();
      // Retry once
    }
    throw err;
  }
});
```

### Cost

| Item | Cost |
|------|------|
| Per secret stored | $0.40/month |
| Per 10,000 API calls | $0.05 |
| Typical app (1 secret, fetched at startup) | ~$0.40/month total |

---

## 10 — IAM Database Authentication

### How It Works

Instead of a password, your app generates a **temporary authentication token** using its IAM role:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  EC2 Instance (has IAM role: ec2-app-role)                       │
│       │                                                           │
│       │  1. App calls: rds.generateDbAuthToken()                 │
│       │     (uses instance's IAM role credentials)                │
│       │                                                           │
│       ▼                                                           │
│  AWS STS: "Yes, ec2-app-role can access RDS"                     │
│       │                                                           │
│       │  2. Returns: temporary token (valid 15 minutes)          │
│       │                                                           │
│       ▼                                                           │
│  App connects to RDS with token as password                      │
│  RDS verifies token with IAM → Connection established            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

```javascript
const { RDS } = require('@aws-sdk/client-rds');
const { Signer } = require('@aws-sdk/rds-signer');
const { Pool } = require('pg');

const signer = new Signer({
  hostname: 'mydb.c9akzq7wgh2l.us-east-1.rds.amazonaws.com',
  port: 5432,
  username: 'iam_app_user',
  region: 'us-east-1',
});

async function createPool() {
  const token = await signer.getAuthToken();
  
  return new Pool({
    host: 'mydb.c9akzq7wgh2l.us-east-1.rds.amazonaws.com',
    port: 5432,
    database: 'myapp',
    user: 'iam_app_user',
    password: token,        // Token IS the password (expires in 15 min)
    ssl: { rejectUnauthorized: true },  // REQUIRED for IAM auth
    max: 20,
  });
}

// Token refresh logic (must regenerate before expiry)
setInterval(async () => {
  const newToken = await signer.getAuthToken();
  // Update pool configuration or recreate pool
}, 10 * 60 * 1000);  // Every 10 minutes (before 15-min expiry)
```

### When to Use IAM Auth vs Secrets Manager

| Factor | IAM Auth | Secrets Manager |
|--------|----------|-----------------|
| No password stored anywhere | ✅ | ⚠️ (stored in SM, but encrypted) |
| Works with connection pools | ⚠️ (token refresh complexity) | ✅ (simple) |
| Maximum connections | 256/second limit | No limit |
| Setup complexity | Medium | Simple |
| AWS-native apps | ✅ Perfect | ✅ Good |
| Multi-cloud apps | ❌ AWS-only | ✅ (use equivalent in other clouds) |

---

## 11 — Multi-AZ Deployments

### How Multi-AZ Works

```
NORMAL OPERATION:
┌─── AZ us-east-1a ───┐     ┌─── AZ us-east-1b ───┐
│                       │     │                       │
│  ┌─────────────────┐ │     │  ┌─────────────────┐ │
│  │  RDS Primary    │─│─────│─►│  RDS Standby    │ │
│  │  (reads+writes) │ │sync │  │  (synchronous   │ │
│  │                 │ │repl │  │   replica)       │ │
│  └────────┬────────┘ │     │  └─────────────────┘ │
│           │           │     │  (no traffic served) │
│           │           │     │                       │
└───────────│───────────┘     └───────────────────────┘
            │
    Your app connects to:
    mydb.c9akzq7wgh2l.us-east-1.rds.amazonaws.com
    → resolves to Primary (10.0.3.47)

AFTER FAILOVER (AZ-a failure):
┌─── AZ us-east-1a ───┐     ┌─── AZ us-east-1b ───┐
│                       │     │                       │
│  ┌─────────────────┐ │     │  ┌─────────────────┐ │
│  │  RDS Primary    │ │     │  │  RDS NEW Primary │ │
│  │  ❌ (DEAD)     │ │     │  │  (promoted!)     │ │
│  │                 │ │     │  │  reads + writes  │ │
│  └─────────────────┘ │     │  └────────┬────────┘ │
│                       │     │           │           │
└───────────────────────┘     └───────────│───────────┘
                                          │
    Same DNS endpoint — AUTO-UPDATED:
    mydb.c9akzq7wgh2l.us-east-1.rds.amazonaws.com
    → NOW resolves to new Primary (10.0.4.23)
    
    ⏱️ Failover time: 60-120 seconds
    📝 Your connection string: UNCHANGED
```

### Multi-AZ vs Read Replicas

| Feature | Multi-AZ | Read Replicas |
|---------|----------|---------------|
| Purpose | High availability (failover) | Read scaling (performance) |
| Replication | Synchronous | Asynchronous |
| Serves traffic? | ❌ Standby is idle | ✅ Serves read queries |
| Failover | Automatic (60-120s) | Manual promotion |
| Same endpoint? | ✅ DNS auto-updates | ❌ Separate endpoint |
| Regions | Same region, different AZ | Can be cross-region |
| Cost | 2x (running two instances) | Per replica instance |

### Migration Path

```
Stage 1: Single-AZ (Development)
  Cost: $15/month (db.t3.micro)
  Risk: AZ failure = downtime

Stage 2: Multi-AZ (Production)
  Cost: $30/month (2x for standby)
  Risk: Region failure only (rare)
  Add: One checkbox in RDS console

Stage 3: Multi-AZ + Read Replicas (Scale)
  Cost: $45+/month (primary + standby + replica)
  Benefit: Offload read traffic (80% of most apps)
  
  App code change:
    writes → primary endpoint
    reads  → reader endpoint (or replica endpoint)
```

---

## 12 — Backup and Recovery

### Automated Backups

| Feature | Details |
|---------|---------|
| Frequency | Daily (during backup window you choose) |
| Type | Full snapshot + transaction logs |
| Retention | 1-35 days (default: 7) |
| Point-in-time recovery | To any second within retention period |
| Impact on performance | Minimal (taken from standby in Multi-AZ) |
| Cost | Free (included in storage cost) |

### Recovery Scenarios

```
Scenario: "Someone deleted the users table at 3:47 PM"

Option 1: Point-in-Time Recovery
  → Restore to a NEW instance at exactly 3:46:59 PM
  → All data up to that second is recovered
  → Takes 10-30 minutes depending on DB size
  → You switch your app to the new endpoint

Option 2: Restore from snapshot
  → Restore the most recent daily snapshot (e.g., last night at 2 AM)
  → You lose everything between 2 AM and 3:47 PM
  → Faster for large DBs but more data loss

⚠️ Both restore to a NEW instance (new endpoint).
   You must update your connection string or rename the instance.
```

### RTO vs RPO

| Metric | Definition | RDS Value |
|--------|-----------|-----------|
| RPO (Recovery Point Objective) | How much data can you lose? | ~5 minutes (transaction logs) |
| RTO (Recovery Time Objective) | How long until back online? | 10-30 minutes (restore time) |

---

## 13 — Performance Monitoring

### RDS Performance Insights

```
┌───────────────────────────────────────────────────────────────┐
│  Performance Insights Dashboard                                │
│                                                                │
│  Top Wait Events:                                             │
│  ████████████████  CPU (40%) — queries consuming CPU          │
│  ████████         IO:DataFileRead (20%) — reading from disk   │
│  ████             Lock:Relation (10%) — table-level locks     │
│                                                                │
│  Top SQL:                                                      │
│  1. SELECT * FROM orders WHERE status='pending' — 15ms avg    │
│     ⚠️ Full table scan! Missing index on 'status'             │
│                                                                │
│  2. SELECT * FROM users WHERE email=$1 — 0.5ms avg ✅         │
│                                                                │
│  Active Connections: 45/150 (30%)  🟢                         │
│  CPU Utilization: 65%              🟡                         │
│  Free Storage: 12 GB               🟢                         │
│  Read IOPS: 850/3000               🟢                         │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

### Key Metrics to Monitor

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| CPU Utilization | >70% | >90% | Scale up or optimize queries |
| Free Storage | <20% | <10% | Enable storage auto-scaling |
| Database Connections | >80% of max | >90% of max | Check for connection leaks |
| Read/Write IOPS | >80% of limit | >90% of limit | Upgrade to io1/io2 storage |
| Replication Lag (replica) | >1 second | >5 seconds | Check replica instance size |
| Freeable Memory | <25% | <10% | Scale up instance |

### CloudWatch Alarms

```bash
# Alert when connections exceed 80% of max
aws cloudwatch put-metric-alarm \
  --alarm-name "RDS-High-Connections" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 120 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:123456:alerts
```

---

## 14 — Tech Lead Decision: RDS vs Aurora vs DynamoDB

| Factor | RDS | Aurora | DynamoDB |
|--------|-----|--------|----------|
| Type | Traditional relational | Cloud-native relational | NoSQL (key-value/document) |
| SQL support | Full SQL | Full SQL (MySQL/PG compatible) | Limited (PartiQL) |
| Scaling | Vertical (bigger instance) | Auto-scaling reads + storage | Infinite horizontal |
| Storage | Up to 64 TB | Auto-grows to 128 TB | Unlimited |
| Performance | Good | 3-5x faster than RDS MySQL | Single-digit ms at any scale |
| Cost | $ (cheapest) | $$ (more expensive) | $ to $$$ (depends on usage) |
| Multi-AZ | Checkbox (separate standby) | Built-in (6 copies, 3 AZs) | Built-in (3 AZs always) |
| Use case | Standard web apps | High-performance relational | Key-value lookups, IoT, gaming |
| Free tier | ✅ 750h/mo | ❌ | ✅ 25 GB + 25 WCU/RCU |

### Decision Framework

```
"Do I need complex JOINs, transactions, and SQL?"
  YES → RDS or Aurora
    "Is this a high-traffic app (>1000 req/s to DB)?"
      YES → Aurora
      NO → RDS (save money)
  NO → 
    "Is access pattern key-value (get by ID, query by partition key)?"
      YES → DynamoDB
      NO → Still probably RDS (SQL is flexible)
```

---

## 15 — Cost Optimization

### Reserved Instances

| Payment | 1-Year Savings | 3-Year Savings |
|---------|---------------|----------------|
| No Upfront | ~30% off | ~40% off |
| Partial Upfront | ~38% off | ~53% off |
| All Upfront | ~42% off | ~57% off |

### Right-Sizing Tips

```
Is your db.t3.medium at 15% CPU average?
→ Downgrade to db.t3.small (save 50%)

Is your 100 GB gp2 using only 200 IOPS?
→ Reduce to 50 GB (gp2 gives 3 IOPS/GB, you only need 150)
   Or switch to gp3 with baseline 3000 IOPS regardless of size

Is your Multi-AZ dev database idle at night?
→ Dev environments: Single-AZ is fine (save 50%)
→ Or use Aurora Serverless v2 (scales to zero)
```

### Monthly Cost Examples

| Setup | Instance | Storage | Multi-AZ | Monthly |
|-------|----------|---------|----------|---------|
| Dev/Test | db.t3.micro | 20 GB gp2 | No | ~$15 |
| Small Prod | db.t3.small | 50 GB gp3 | Yes | ~$70 |
| Medium Prod | db.r5.large | 200 GB gp3 | Yes | ~$450 |
| Large Prod | db.r5.2xlarge | 1 TB io1 | Yes + 2 replicas | ~$3,000 |

---

## 16 — Common Pitfalls and "What Would Go Wrong"

| Scenario | What Goes Wrong | Fix |
|----------|----------------|-----|
| RDS publicly accessible | Database exposed to internet; bots scan for open ports within minutes | Disable public access; private subnets only |
| No connection pooling | Connection exhaustion under load (FATAL: too many connections) | Use pg-pool/HikariCP with sensible max |
| Credentials in env vars | Leak in CI logs, process dumps, `docker inspect`, ECS task definitions | Use Secrets Manager or IAM auth |
| No encryption at rest | Compliance failure; data breach if disks accessed physically | Enable at creation (can't add later without migration) |
| Single-AZ in production | AZ failure = hours of downtime | Enable Multi-AZ (one checkbox, zero code changes) |
| No automated backups | Accidental DELETE = catastrophic data loss | Enable with 7-35 day retention |
| Pool too large per instance | 10 app instances × 50 pool = 500 connections > max_connections | Calculate: max / num_instances = per-instance max |
| Not monitoring connections | Slow leak until crash at 3 AM | CloudWatch alarm on DatabaseConnections |
