---
title: "Phase 8 — EC2 ↔ RDS Connection"
description: "Backend-to-database connectivity — connection strings, security groups, connection pooling, secrets management."
order: 8
---

# Phase 8 — EC2 ↔ RDS Connection

> **Category:** Infrastructure · **Difficulty:** Intermediate · **Related:** VPC · Security Groups · Secrets

---

## TLDR

Your backend connects to RDS via a connection string using the RDS endpoint (private DNS within VPC). RDS sits in a private subnet — unreachable from internet. The only thing allowed to connect is your EC2 (enforced by Security Group chaining). Use connection pooling (reuse connections instead of opening new ones per request). Store credentials in environment variables at minimum, AWS Secrets Manager for production.

---

## 01 — How the Connection Works

```
EC2 (10.0.1.42, public subnet)
  │
  │ TCP connection to port 5432
  │ (stays within AWS private network)
  │
  ▼
RDS (10.0.2.15, private subnet)
  │
  └── my-db.abc123.ap-south-1.rds.amazonaws.com
      (DNS name resolving to private IP)
```

The RDS endpoint is a DNS name that resolves to a **private IP** inside your VPC. This connection never touches the internet.

---

## 02 — Connection String Anatomy

```
postgresql://admin:mypassword@my-db.abc123.rds.amazonaws.com:5432/myapp
│            │      │          │                                │    │
│            │      │          │                                │    └─ Database name
│            │      │          │                                └─ Port
│            │      │          └─ Host (RDS endpoint)
│            │      └─ Password
│            └─ Username
└─ Protocol
```

### In Code (Node.js with Sequelize)

```javascript
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,     // 'myapp'
  process.env.DB_USER,     // 'admin'  
  process.env.DB_PASSWORD, // from .env or Secrets Manager
  {
    host: process.env.DB_HOST,  // RDS endpoint
    port: 5432,
    dialect: 'postgres',
    logging: false,              // Disable SQL logging in prod
    pool: {
      max: 10,        // Max simultaneous connections
      min: 2,         // Keep minimum 2 alive
      acquire: 30000, // Wait 30s before timeout
      idle: 10000     // Close idle connections after 10s
    }
  }
);
```

---

## 03 — Security Group Chain (The Critical Setup)

```
EC2 Security Group (sg-web):
  Inbound: 443 from 0.0.0.0/0
  Outbound: All (default)

RDS Security Group (sg-database):
  Inbound: 5432 from sg-web    ← THIS IS THE KEY
  Outbound: All (default)
```

The RDS Security Group allows inbound on port 5432 ONLY from the EC2's Security Group ID — not from an IP address. This means:

- ✅ Any EC2 instance in sg-web can connect
- ✅ Replace EC2? New instance inherits SG → still works
- ❌ Your laptop? Can't connect (not in sg-web)
- ❌ Other AWS accounts? Can't connect
- ❌ Internet? Can't connect (RDS has no public IP anyway)

---

## 04 — Connection Pooling (Critical for Performance)

### The Problem

```
Without pooling:
  Each request → Open TCP connection → TLS negotiate → Auth → Query → Close
  Time: ~50-100ms overhead PER REQUEST (before any query runs)
  
  At 100 req/sec = 100 new connections/sec = database chokes
```

### The Solution

```
With pooling:
  App startup → Open 10 connections (pool)
  Each request → Borrow from pool → Query → Return to pool
  Time: ~1ms overhead (connection already open!)
  
  At 100 req/sec = same 10 connections reused = database happy
```

### Pool Configuration

```javascript
pool: {
  max: 10,         // Don't exceed this (RDS free tier max_connections ≈ 60)
  min: 2,          // Always keep 2 warm
  acquire: 30000,  // If all 10 busy, wait 30s before erroring
  idle: 10000      // Disconnect idle connections after 10s
}
```

### How Many Connections?

```
RDS free tier (db.t3.micro): ~60 max connections
Your app pool: 10 connections
Remaining: 50 (for other services, admin access, monitoring)

Rule of thumb: pool max = (RDS max_connections / number of app instances) - buffer
```

---

## 05 — Credentials Management Ladder

### Level 1: Environment Variables (Minimum Acceptable)

```bash
# .env file on EC2 (chmod 600!)
DB_HOST=my-db.abc123.rds.amazonaws.com
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=my-strong-password-123
DB_NAME=myapp
```

### Level 2: AWS Secrets Manager (Production)

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function getDbCredentials() {
  const client = new SecretsManagerClient({ region: 'ap-south-1' });
  const response = await client.send(new GetSecretValueCommand({
    SecretId: 'prod/myapp/database'
  }));
  return JSON.parse(response.SecretString);
  // Returns: { username, password, host, port, dbname }
}
```

**Benefits:** Automatic rotation, audit trail, no secrets on disk, centralized management.

### Level 3: IAM Database Authentication (Gold Standard)

Instead of passwords, generate short-lived tokens:

```javascript
const { RDS } = require('@aws-sdk/client-rds');
const signer = new RDS.Signer({
  region: 'ap-south-1',
  hostname: 'my-db.abc123.rds.amazonaws.com',
  port: 5432,
  username: 'iam_user'
});

const token = await signer.getAuthToken();  // Valid 15 minutes
// Use token as password in connection string
```

**Benefits:** No permanent password exists. Token expires. EC2's IAM role authorizes access. Truly "zero secrets."

---

## 06 — RDS Subnet Groups

RDS requires a "DB Subnet Group" — at least 2 subnets in different Availability Zones:

```
DB Subnet Group: "my-db-subnets"
├── Subnet: 10.0.2.0/24 (AZ: ap-south-1a)  ← Primary RDS
└── Subnet: 10.0.4.0/24 (AZ: ap-south-1b)  ← Standby (for failover)
```

**Why 2 AZs?** Even on free tier, AWS needs the OPTION to failover. If ap-south-1a goes down, RDS can switch to ap-south-1b automatically (Multi-AZ deployment).

---

## 07 — Accessing RDS from Your Laptop (Development)

RDS is in a private subnet. You can't connect directly. Options:

### Option 1: SSH Tunnel (Most Common)

```bash
ssh -i key.pem -L 5432:rds-endpoint:5432 ec2-user@ec2-ip

# Now connect your DB client to localhost:5432
```

### Option 2: AWS SSM Session Manager Port Forwarding

```bash
aws ssm start-session \
  --target i-1234567890abcdef0 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["rds-endpoint"],"portNumber":["5432"],"localPortNumber":["5432"]}'
```

No SSH key needed. Uses IAM for auth. Full audit trail.

### Option 3: Make RDS Publicly Accessible (Dev Only, NOT for Prod)

Toggle "Publicly Accessible" in RDS settings + add your IP to Security Group. **Never in production.**

---

## 08 — Common Issues & Debugging

### "Connection timed out"

```
Checklist:
1. RDS Security Group allows your EC2's SG on correct port?
2. EC2 and RDS in same VPC?
3. Route table allows traffic between subnets?
4. RDS instance is running (not stopped)?
```

### "Too many connections"

```
Your app opened more connections than RDS allows.
Fix: Implement connection pooling with proper max limit.
Check: SHOW VARIABLES LIKE 'max_connections'; (MySQL)
       SELECT * FROM pg_stat_activity; (PostgreSQL)
```

### "Connection refused"

```
Port mismatch (3306 vs 5432), or RDS isn't listening.
Verify: endpoint and port in AWS console match your connection string.
```

---

## 🧠 Quick Recall

1. Why does RDS have no public IP?
2. What does "source = sg-web" mean in the RDS Security Group?
3. Why is connection pooling critical?
4. How does IAM DB auth work (no password)?
5. Why does RDS need subnets in 2 AZs?

---

## 🎯 Interview Q&A

**Q: How would you secure the database connection in production?**

A: (1) RDS in private subnet — no internet access. (2) Security Group allows only app EC2's SG. (3) Encrypt in transit (SSL/TLS for the DB connection). (4) IAM database auth or Secrets Manager with rotation. (5) Connection pooling to manage load. (6) Encrypt at rest (RDS encryption enabled).

**Q: Your app gets "too many connections" errors during peak traffic. Diagnosis?**

A: Connection pool exhaustion or pool not configured. Check: pool max setting vs actual connections (pg_stat_activity). Fixes: increase pool max (up to RDS limit), reduce idle timeout, add connection queuing, scale horizontally (more app instances each with smaller pools), or use RDS Proxy.

**Q: What is RDS Proxy and when would you use it?**

A: Managed connection pooling service between your app and RDS. Benefits: handles thousands of app connections → multiplexes to a small number of DB connections. Use when: Lambda functions (each invocation = new connection), many microservices hitting same DB, connection churn is high.

**Q: Explain the difference between Multi-AZ and Read Replicas.**

A: Multi-AZ: synchronous standby in another AZ, automatic failover on primary failure. No read traffic served from standby. For high availability. Read Replicas: asynchronous copies you CAN read from. Distribute read load. No automatic failover. For read scalability.

---

## 🤔 Brainstorming Questions

1. **Your app has 100 Lambda functions each opening their own DB connections.** At scale, RDS hits max_connections. How do you solve this without RDS Proxy? (Think: API Gateway pattern, consolidation)

2. **You want to rotate the database password monthly.** How do you do this without downtime? (Secrets Manager rotation + connection retry logic)

3. **RDS is in a private subnet but needs to download extensions/updates.** How does it access the internet? (NAT Gateway or VPC endpoints)

4. **Why doesn't RDS just use IAM authentication by default?** What are the downsides? (15-min token refresh, driver support, performance overhead)

5. **Your Security Group allows EC2's SG to access RDS. What if an attacker gets code execution on your EC2?** They now have DB access. How do you limit blast radius? (Least-privilege DB user, row-level security, audit logging)

---

*Previous: [Phase 7 — Cloudflare](/aws-infrastructure/07-cloudflare) · Next: [Phase 9 — App Authentication](/aws-infrastructure/09-app-authentication)*
