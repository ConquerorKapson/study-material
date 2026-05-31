---
title: "Phase 12 — Advanced Topics & Next Steps"
description: "S3, Load Balancers, Auto Scaling, CI/CD, Docker, environment management — where to grow from here."
order: 12
---

# Phase 12 — Advanced Topics & Next Steps

> **Category:** Infrastructure · **Difficulty:** Advanced · **Related:** S3 · ELB · Docker · CI/CD

---

## TLDR

Once your basic stack works (EC2 + RDS + NGINX + Cloudflare), the next level is: S3 for file storage (never store uploads on EC2), Load Balancers for scaling, Auto Scaling for elasticity, CI/CD for automated deployments, and Docker for reproducible environments. Each solves a specific limitation of the single-server setup.

---

## 01 — S3: File Storage Done Right

### Why Not Store Files on EC2?

| On EC2 Disk | On S3 |
|------------|-------|
| ❌ Limited space (8-30GB) | ✅ Unlimited |
| ❌ Lost if instance terminates | ✅ 99.999999999% durable (11 nines) |
| ❌ Not replicated | ✅ Replicated across AZs |
| ❌ Tied to one server | ✅ Accessible from anywhere |
| ❌ Serves files via your app (wastes CPU) | ✅ Direct download via pre-signed URLs |

### Pre-Signed URLs (The Pattern)

```
User wants to upload a file:
1. Frontend: "I want to upload avatar.jpg"
2. Backend: Generates pre-signed PUT URL (valid 5 min)
3. Backend → Frontend: "Upload directly to this S3 URL"
4. Frontend → S3: Direct upload (bypasses your server entirely!)
5. S3 → Done. File stored.

User wants to download:
1. Frontend: "I want user's avatar"
2. Backend: Generates pre-signed GET URL (valid 1 hour)
3. Frontend: Downloads directly from S3
```

### Implementation

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: 'ap-south-1' });

// Generate upload URL
async function getUploadUrl(filename, contentType) {
  const command = new PutObjectCommand({
    Bucket: 'my-app-uploads',
    Key: `uploads/${Date.now()}-${filename}`,
    ContentType: contentType
  });
  return getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
}
```

### S3 Bucket Security

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }
  ]
}
// Block all non-HTTPS access
```

---

## 02 — Elastic Load Balancer (ALB)

### When You Need It

```
Current: 1 EC2 → handles all traffic
Problem: EC2 goes down = entire site down
         EC2 overloaded = everyone slow

Solution: Multiple EC2s behind a Load Balancer
```

### Architecture with ALB

```
Users → ALB → EC2 #1 (AZ-a)
           → EC2 #2 (AZ-b)
           → EC2 #3 (AZ-a)
           
Benefits:
- One instance dies → ALB routes to healthy ones
- SSL termination at ALB level (not on each EC2)
- Health checks auto-remove unhealthy instances
```

### ALB Features

| Feature | What It Does |
|---------|-------------|
| Path-based routing | `/api/*` → API instances, `/*` → frontend instances |
| Host-based routing | `api.myapp.com` → one group, `admin.myapp.com` → another |
| Health checks | Pings `/health` every 30s, removes unhealthy targets |
| SSL termination | Handles TLS at ALB, plain HTTP to instances |
| Sticky sessions | Optional: same user → same instance (for sessions) |

---

## 03 — Auto Scaling Groups (ASG)

### The Idea

```
Low traffic (night):   2 instances running
High traffic (day):    8 instances running
Traffic spike (sale):  20 instances running
After spike:           Back to 2 instances

You pay only for what you're using at each moment.
```

### Scaling Policies

| Policy Type | Trigger | Example |
|-------------|---------|---------|
| Target tracking | Maintain metric at target | "Keep average CPU at 60%" |
| Step scaling | Different actions at different thresholds | "CPU > 70% add 2; CPU > 90% add 5" |
| Scheduled | Time-based | "Scale to 10 at 9 AM, back to 2 at midnight" |
| Predictive | ML-based forecasting | "Expected spike at 6 PM based on last week" |

### Launch Template

```
When ASG needs a new instance, it uses a Launch Template:
- AMI: your Golden AMI (pre-configured)
- Instance type: t3.small
- Security Group: sg-web
- IAM Role: my-app-role
- User Data: git pull + pm2 start
```

---

## 04 — CI/CD Pipeline (Automated Deployments)

### The Problem with Manual Deploy

```
Developer: *SSH into production*
Developer: git pull
Developer: npm install
Developer: pm2 restart
Developer: *crosses fingers*
Developer: *it's broken, rolls back manually*

Problems: error-prone, no audit trail, no tests, scary
```

### GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  deploy:
    needs: test  # Only deploy if tests pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ~/app
            git pull origin main
            npm ci --production
            pm2 reload ecosystem.config.js
            echo "Deployed at $(date)"
```

### Deployment Strategies

| Strategy | How | Risk | Rollback |
|----------|-----|------|----------|
| **In-place** | Update existing server | High (broken = down) | Manual |
| **Rolling** | Update instances one at a time | Medium | Stop rolling |
| **Blue-Green** | New fleet → switch traffic | Low | Switch back |
| **Canary** | Send 5% traffic to new version | Lowest | Route 100% to old |

---

## 05 — Docker & Containers

### Why Containers?

```
Without Docker:
  "Works on my machine" → fails on EC2 (different Node version, missing lib)

With Docker:
  Package EVERYTHING (code + runtime + OS libs) into one image
  Same image runs identically: locally, on EC2, on any cloud
```

### Dockerfile (Your App)

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
```

### Build and Run

```bash
# Build image
docker build -t my-backend:v1.2.3 .

# Run container
docker run -d \
  --name backend \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  my-backend:v1.2.3
```

### Evolution Path

```
Stage 1: EC2 + pm2 (where you are now)
Stage 2: EC2 + Docker (reproducible deploys)
Stage 3: ECS or EKS (managed container orchestration)
Stage 4: Fargate (serverless containers — no EC2 to manage)
```

---

## 06 — Environment Management

### Three Environments (Minimum)

| Environment | Purpose | Data |
|-------------|---------|------|
| **Development** | Local machine | Fake/seed data |
| **Staging** | Clone of production | Anonymized production data |
| **Production** | Real users | Real data |

### Rules

- ✅ Staging should mirror production (same instance types, same config)
- ❌ Never test in production
- ❌ Never use production data in development (GDPR, security)
- ✅ Use environment variables to switch configs (not code changes)

---

## 07 — The Complete Architecture (Where You're Headed)

```
                         Route 53 (DNS)
                              │
                              ▼
                         Cloudflare (CDN + WAF)
                              │
                              ▼
                         ALB (Load Balancer)
                        /     |     \
                       ▼      ▼      ▼
                    EC2-1   EC2-2   EC2-3  (Auto Scaling Group)
                    Docker  Docker  Docker
                       \      |      /
                        ▼     ▼     ▼
                    RDS (Multi-AZ) + Read Replicas
                              │
                    ElastiCache (Redis - sessions/cache)
                              │
                    S3 (file uploads)
                              │
                    CloudWatch (monitoring)
                              │
                    GitHub Actions (CI/CD)
```

---

## 🧠 Quick Recall

1. Why store files in S3 instead of EC2 disk?
2. What does a pre-signed URL do?
3. When do you need an ALB?
4. What's the difference between rolling and blue-green deploy?
5. What problem does Docker solve?
6. Why keep staging identical to production?

---

## 🎯 Interview Q&A

**Q: Design a scalable web application architecture on AWS.**

A: Route 53 for DNS → CloudFront/Cloudflare CDN → ALB distributing to Auto Scaling Group of EC2s (or ECS/Fargate containers) → RDS Multi-AZ for writes, Read Replicas for reads → ElastiCache Redis for sessions/caching → S3 for file storage → CloudWatch for monitoring → CI/CD with GitHub Actions or CodePipeline. Each layer addresses specific failure modes and performance bottlenecks.

**Q: How would you handle file uploads in a distributed system?**

A: Never to your app server. Use pre-signed S3 URLs: backend generates a signed upload URL (limited time, specific key), client uploads directly to S3. For processing: S3 event triggers Lambda for thumbnail generation, virus scanning, etc. Benefits: app server not bottlenecked by uploads, infinite scale, direct CDN serving.

**Q: Compare ECS, EKS, and Fargate.**

A: ECS: AWS-native container orchestration (simpler, AWS-integrated). EKS: Managed Kubernetes (complex but portable, multi-cloud). Fargate: Serverless containers (no EC2 to manage, pay per task, simplest). Choose ECS for AWS-native shops, EKS for Kubernetes expertise/portability, Fargate for simplicity and variable workloads.

**Q: What's the difference between horizontal and vertical scaling?**

A: Vertical: bigger machine (t3.micro → m5.2xlarge). Simple but has ceiling, requires downtime. Horizontal: more machines (1 EC2 → 10 EC2s behind ALB). No ceiling, needs stateless app design, more complex. Always prefer horizontal for production — it's fault-tolerant AND scalable.

---

## 🤔 Brainstorming Questions

1. **Your single EC2 handles 500 req/sec fine today.** At what point do you add complexity (ALB, ASG)? What's the cost of adding it too early vs too late?

2. **Docker images include OS libraries.** Doesn't this waste space compared to running directly on EC2? When is the overhead worth it? (Think: consistency vs size)

3. **Blue-green deployments need double the infrastructure during transition.** How do you justify the cost? When is in-place update acceptable?

4. **Serverless (Lambda) eliminates EC2 entirely.** Why does anyone still use EC2? What can't Lambda do? (Think: long-running processes, WebSockets, GPU workloads, cost at scale)

5. **You're building a startup MVP.** How much of this "proper" architecture do you implement now vs later? What's the minimum viable infrastructure? (EC2 + RDS + NGINX is often enough for 0-10K users)

---

## The Complete Picture: Every Layer Solves a Problem

| Layer | Problem It Solves |
|-------|------------------|
| VPC + Private Subnets | Isolates network, hides database |
| Security Groups | Controls traffic at instance level |
| SSH + Key Pairs | Secure admin access |
| NGINX | SSL, routing, static files, protection |
| Let's Encrypt | End-to-end encryption |
| Cloudflare | DDoS, CDN, WAF at the edge |
| IAM Roles | Service permissions without stored keys |
| CloudWatch | Visibility into health and costs |
| S3 | Scalable file storage off your server |
| ALB + ASG | Availability and elastic scaling |
| CI/CD | Safe, automated, repeatable deployments |
| Docker | Environment consistency |

> **Once you see each piece as an answer to a specific threat or bottleneck, the whole architecture stops feeling arbitrary and starts feeling logical.**

---

*Previous: [Phase 11 — Monitoring & Logging](/aws-infrastructure/11-monitoring-logging) · [Back to Glossary](/aws-infrastructure/00-glossary)*
