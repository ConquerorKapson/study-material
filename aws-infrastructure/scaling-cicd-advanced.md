---
title: "Scaling, CI/CD, Containers, and Beyond — Production Architecture Patterns"
description: "Load balancers, auto scaling, Docker, CI/CD pipelines, S3 for uploads, multi-environment setup, and the path from single EC2 to production-grade infrastructure."
order: 12
---

# Scaling, CI/CD, Containers, and Beyond — Production Architecture Patterns

> **Category:** AWS Infrastructure · **Difficulty:** Advanced · **Related:** ALB · Auto Scaling · Docker · CI/CD · S3 · ECS

---

## 01 — TL;DR

- **S3** is infinite object storage — file uploads go here, NEVER on EC2 disk (instances die, disks die with them)
- **ALB (Application Load Balancer)** distributes traffic across multiple instances — enables scaling and zero-downtime deploys
- **Auto Scaling Groups** automatically add/remove instances based on demand — you define the rules, AWS handles the rest
- **Docker** eliminates "works on my machine" — your app runs identically everywhere (laptop, CI, staging, production)
- **CI/CD** automates the path from code commit to production — no manual SSH, no human error
- **Blue-Green deployments** give you zero-downtime releases with instant rollback
- **The evolution path:** Single EC2 → EC2 + RDS → ALB + ASG → Containers → Serverless — each step solves specific scaling pain

**Why this matters:** This is where you stop being "someone who can deploy to AWS" and become "someone who can architect for production." Every senior/staff interview tests this. The difference between a $120k and $200k engineer is often "can you design a system that handles 10x traffic without falling over?"

---

## 02 — S3 (Simple Storage Service)

### What S3 Is (and Isn't)

S3 is **object storage** — think of it as an infinite, durable key-value store where keys are paths and values are files.

| S3 IS | S3 IS NOT |
|-------|-----------|
| Object storage (flat namespace) | A filesystem (no real directories) |
| Infinite capacity | Limited by anything practical |
| 99.999999999% durability (11 nines) | Going to lose your data |
| HTTP-accessible | A database |
| Great for static assets, backups, uploads | A place to run code |

### Why File Uploads Should NEVER Go on EC2 Disk

```
Scenario: User uploads a profile photo to your EC2 instance's /uploads/ folder

What happens when:
- Instance crashes → ❌ All uploads GONE
- Auto Scaling adds second instance → ❌ New instance has empty /uploads/
- You deploy new code → ❌ AMI doesn't include runtime uploads
- Disk fills up → ❌ App crashes, can't accept more uploads
```

**The rule: EC2 instances must be stateless and disposable.** Any persistent data goes to S3 (files), RDS (structured data), or ElastiCache (session data).

### Core Concepts

```
┌─────────────────────────────────────────┐
│  S3 Structure                           │
│                                         │
│  Bucket: my-app-uploads                 │
│  ├── avatars/user-123/photo.jpg  ← Key  │
│  ├── documents/invoice-456.pdf          │
│  └── temp/upload-session-789.tmp        │
│                                         │
│  Note: "folders" are just key prefixes  │
│  There's no actual directory structure  │
└─────────────────────────────────────────┘
```

### Pre-signed URLs (Secure Upload/Download)

Instead of routing file uploads through your server, let clients upload directly to S3:

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: 'us-east-1' });

// Generate a pre-signed upload URL (valid for 5 minutes)
async function getUploadUrl(userId, filename) {
  const key = `avatars/${userId}/${Date.now()}-${filename}`;
  const command = new PutObjectCommand({
    Bucket: 'my-app-uploads',
    Key: key,
    ContentType: 'image/jpeg',
    Metadata: { uploadedBy: userId }
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 });
  return { url, key };
}

// Client uploads directly to S3 using the pre-signed URL
// No file data passes through your server!
```

### Benefits of Pre-signed URLs

```
Traditional (bad):                  Pre-signed (good):
Client → Your Server → S3          Client → S3 directly
                                    (Your server only generates the URL)

- Server bandwidth bottleneck       - No server bandwidth used
- Server memory for large files     - No memory pressure
- Server timeout on slow uploads    - S3 handles the upload
- Server scales with upload volume  - S3 scales infinitely
```

### Lifecycle Policies

```json
{
  "Rules": [
    {
      "ID": "DeleteTempUploads",
      "Filter": { "Prefix": "temp/" },
      "Status": "Enabled",
      "Expiration": { "Days": 1 }
    },
    {
      "ID": "ArchiveOldDocuments",
      "Filter": { "Prefix": "documents/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 90, "StorageClass": "STANDARD_IA" },
        { "Days": 365, "StorageClass": "GLACIER" }
      ]
    }
  ]
}
```

### Static Website Hosting

```bash
# Host a React/Vue/Angular SPA on S3 + CloudFront
aws s3 sync build/ s3://my-frontend-bucket --delete
# Cost: ~$0.50/month for most sites (vs $20+/month for an EC2 instance)
```

---

## 03 — Elastic Load Balancer (ALB)

### What It Does

An Application Load Balancer (ALB) sits in front of your instances and distributes incoming requests across them.

```
                    ┌──────────┐
Users ──────────────▶   ALB    │
                    │          │
                    └────┬─────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
      ┌────▼───┐    ┌────▼───┐    ┌────▼───┐
      │  EC2   │    │  EC2   │    │  EC2   │
      │  (a)   │    │  (b)   │    │  (c)   │
      └────────┘    └────────┘    └────────┘
```

### Why You Need It

| Without ALB | With ALB |
|-------------|----------|
| Single point of failure | Traffic spreads across instances |
| DNS points to one IP | DNS points to ALB (elastic IP) |
| Can't scale horizontally | Add/remove instances seamlessly |
| Downtime during deploys | Zero-downtime deploys (rolling) |
| SSL on each instance | SSL termination at ALB (simpler) |

### Key Features

**Path-based routing:**
```
/api/*     → Backend target group (EC2 instances running Node.js)
/admin/*   → Admin target group (separate instances)
/*         → Frontend target group (or S3/CloudFront)
```

**Host-based routing:**
```
api.myapp.com    → API target group
admin.myapp.com  → Admin target group
www.myapp.com    → Frontend target group
```

### Health Checks

The ALB constantly checks if instances are healthy:

```bash
# ALB health check configuration
Path: /health
Interval: 30 seconds
Timeout: 5 seconds
Healthy threshold: 2 consecutive successes
Unhealthy threshold: 3 consecutive failures
```

If an instance fails health checks → ALB stops sending traffic to it → Auto Scaling replaces it.

### SSL/TLS Termination

```
Client ──HTTPS──▶ ALB ──HTTP──▶ EC2 instances
                   │
                   └── SSL certificate lives HERE
                       (AWS Certificate Manager, free)
```

Benefits:
- One certificate to manage (on ALB), not one per instance
- EC2 instances do less work (no encryption overhead)
- ACM certificates auto-renew

### Creating an ALB (CLI)

```bash
# Create the ALB
aws elbv2 create-load-balancer \
  --name production-alb \
  --subnets subnet-abc123 subnet-def456 \
  --security-groups sg-abc123 \
  --scheme internet-facing \
  --type application

# Create a target group
aws elbv2 create-target-group \
  --name production-targets \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-abc123 \
  --health-check-path /health \
  --health-check-interval-seconds 30

# Create listener (HTTPS)
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:.../targetgroup/...
```

---

## 04 — Auto Scaling Groups

### The Concept

An Auto Scaling Group (ASG) maintains a fleet of EC2 instances and automatically adjusts capacity based on demand.

```
┌─────────────────────────────────────────────────────────┐
│  Auto Scaling Group                                     │
│                                                         │
│  Min: 2    Desired: 3    Max: 10                        │
│                                                         │
│  ┌─────┐  ┌─────┐  ┌─────┐                             │
│  │ EC2 │  │ EC2 │  │ EC2 │  ← 3 running (desired)      │
│  └─────┘  └─────┘  └─────┘                             │
│                                                         │
│  Traffic spike detected → scale to desired: 6           │
│                                                         │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐│
│  │ EC2 │  │ EC2 │  │ EC2 │  │ EC2 │  │ EC2 │  │ EC2 ││
│  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Launch Template

A launch template defines HOW new instances are created:

```bash
aws ec2 create-launch-template \
  --launch-template-name production-app \
  --launch-template-data '{
    "ImageId": "ami-0abc123",
    "InstanceType": "t3.medium",
    "KeyName": "production-key",
    "SecurityGroupIds": ["sg-abc123"],
    "IamInstanceProfile": {
      "Arn": "arn:aws:iam::123456789012:instance-profile/AppRole"
    },
    "UserData": "IyEvYmluL2Jhc2gKY2QgL2FwcApnaXQgcHVsbApucG0gaW5zdGFsbApwbTIgcmVzdGFydCBhbGw="
  }'
```

### Scaling Policies

**Target Tracking (Simplest — AWS does the math):**

```bash
# Keep CPU at 60% — AWS adds/removes instances to maintain this
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name production-asg \
  --policy-name cpu-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 60.0
  }'
```

**Step Scaling (Fine-grained control):**

```
CPU 60-70% → Add 1 instance
CPU 70-85% → Add 2 instances
CPU > 85%  → Add 4 instances
CPU < 40%  → Remove 1 instance
CPU < 25%  → Remove 2 instances
```

**Scheduled Scaling (Predictable patterns):**

```bash
# Scale up before business hours
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name production-asg \
  --scheduled-action-name scale-up-morning \
  --recurrence "0 8 * * MON-FRI" \
  --desired-capacity 6

# Scale down at night
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name production-asg \
  --scheduled-action-name scale-down-night \
  --recurrence "0 22 * * *" \
  --desired-capacity 2
```

### Cooldown Periods

```
Without cooldown:
Spike → Add 3 instances → Still provisioning → Alarm fires again → Add 3 MORE → Over-provisioned!

With cooldown (300 seconds):
Spike → Add 3 instances → Wait 5 min → Check again → Maybe add 1 more → Stable
```

---

## 05 — The Complete Scalable Architecture

### Production Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AWS Region (us-east-1)                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    VPC (10.0.0.0/16)                         │    │
│  │                                                             │    │
│  │  ┌───────────────────────┐  ┌───────────────────────────┐  │    │
│  │  │   AZ-a (us-east-1a)  │  │   AZ-b (us-east-1b)       │  │    │
│  │  │                       │  │                           │  │    │
│  │  │  Public Subnet        │  │  Public Subnet            │  │    │
│  │  │  ┌─────────────────┐  │  │  ┌─────────────────────┐  │  │    │
│  │  │  │      ALB        │  │  │  │      ALB             │  │  │    │
│  │  │  └────────┬────────┘  │  │  └──────────┬──────────┘  │  │    │
│  │  │           │            │  │             │              │  │    │
│  │  │  Private Subnet        │  │  Private Subnet            │  │    │
│  │  │  ┌─────────────────┐  │  │  ┌─────────────────────┐  │  │    │
│  │  │  │  EC2 (App)      │  │  │  │  EC2 (App)           │  │  │    │
│  │  │  │  EC2 (App)      │  │  │  │  EC2 (App)           │  │  │    │
│  │  │  └─────────────────┘  │  │  └─────────────────────┘  │  │    │
│  │  │           │            │  │             │              │  │    │
│  │  │  ┌─────────────────┐  │  │  ┌─────────────────────┐  │  │    │
│  │  │  │  RDS Primary    │  │  │  │  RDS Standby (MZ)   │  │  │    │
│  │  │  └─────────────────┘  │  │  └─────────────────────┘  │  │    │
│  │  │                       │  │                           │  │    │
│  │  └───────────────────────┘  └───────────────────────────┘  │    │
│  │                                                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │    │
│  │  │ ElastiCache  │  │     S3       │  │  Secrets Manager │  │    │
│  │  │ (Redis)      │  │  (uploads)   │  │  (DB creds, keys)│  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │ CloudFront   │ ← Static assets (JS, CSS, images)                │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Session Stickiness Considerations

| Approach | Pros | Cons |
|----------|------|------|
| Sticky sessions (ALB) | Simple, works with existing code | Can't scale evenly, lose session if instance dies |
| External session store (Redis) | ✅ True statelessness, any instance can serve any request | Requires code change, slight latency |
| JWT tokens (client-side) | No server-side state at all | Can't invalidate, size limitations |

**Recommendation:** Always use external session store (Redis/ElastiCache). Sticky sessions are a bandaid that breaks at scale.

---

## 06 — Docker and Containers

### The Problem Docker Solves

```
Developer: "It works on my machine!"
Ops:       "Well, your machine isn't in production."

The problem:
- Developer runs Node 18 on macOS with libssl 1.1
- Production runs Node 16 on Ubuntu with libssl 3.0
- Different OS, different libraries, different versions, different behavior
```

Docker solves this by packaging your app WITH its entire runtime environment.

### Core Concepts

| Concept | What It Is | Analogy |
|---------|-----------|---------|
| **Image** | Read-only template | A class definition |
| **Container** | Running instance of an image | An object (instance of class) |
| **Dockerfile** | Recipe to build an image | The constructor |
| **Registry** | Storage for images (ECR, Docker Hub) | npm registry for packages |
| **Layer** | Each instruction creates a cached layer | Git commits (incremental) |

### Production Dockerfile (Node.js, Multi-stage)

```dockerfile
# ─── Stage 1: Build ───────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached if package.json unchanged)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────
FROM node:20-alpine AS production

# Security: don't run as root
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Security: non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### Why Multi-Stage Matters

| Single-stage | Multi-stage |
|--------------|-------------|
| 1.2 GB image (includes dev deps, source, build tools) | 180 MB image (only production runtime) |
| TypeScript compiler in production (why?) | Only compiled JS |
| Slower to pull and deploy | Fast to pull and deploy |
| Larger attack surface | Minimal attack surface |

### Docker Compose for Local Development

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/myapp
      - REDIS_URL=redis://cache:6379
      - NODE_ENV=development
    volumes:
      - ./src:/app/src  # Hot reload in development
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: myapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 5s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

```bash
# Start everything
docker compose up -d

# View logs
docker compose logs -f app

# Tear down
docker compose down -v
```

---

## 07 — ECS (Elastic Container Service)

### What ECS Does

ECS is AWS's container orchestrator — it manages running Docker containers across a fleet of machines.

### ECS Concepts

```
┌─────────────────────────────────────────────────────┐
│  ECS Cluster                                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Service: "api" (desired: 3)                  │  │
│  │                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐    │  │
│  │  │  Task 1  │  │  Task 2  │  │  Task 3  │    │  │
│  │  │(container)│  │(container)│  │(container)│    │  │
│  │  └──────────┘  └──────────┘  └──────────┘    │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Service: "worker" (desired: 2)               │  │
│  │                                               │  │
│  │  ┌──────────┐  ┌──────────┐                   │  │
│  │  │  Task 1  │  │  Task 2  │                   │  │
│  │  └──────────┘  └──────────┘                   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Fargate vs EC2 Launch Type

| Factor | Fargate (Serverless) | EC2 Launch Type |
|--------|---------------------|-----------------|
| Server management | 🟢 None — AWS manages | 🟡 You manage EC2 fleet |
| Pricing | Per vCPU + memory per second | Per EC2 instance |
| Scaling | 🟢 Instant (no pre-provisioning) | 🟡 Depends on EC2 capacity |
| Cost for steady load | 🟡 Can be expensive | 🟢 Cheaper with Reserved |
| GPU support | ❌ No | ✅ Yes |
| Best for | Variable workloads, small teams | Steady high-throughput, GPU, cost optimization |

### When to Move from EC2 to ECS

| Signal | You're Ready for ECS |
|--------|---------------------|
| Deploying multiple services | ✅ ECS manages them independently |
| "Works on my machine" problems | ✅ Docker eliminates them |
| Deploy takes 30+ minutes | ✅ Container deploys in seconds |
| Scaling is painful | ✅ ECS auto-scales services |
| Team growing (5+ devs) | ✅ Isolated services, independent deploys |

---

## 08 — CI/CD Pipeline

### Why Manual Deployments Are Dangerous

```
Manual deploy steps:
1. SSH into production server
2. git pull (hope there are no merge conflicts)
3. npm install (hope nothing breaks)
4. pm2 restart all (hope it comes back up)
5. Check the site manually (hope you didn't miss anything)

What can go wrong:
- Deployed to wrong branch
- Forgot to run migrations
- npm install failed silently
- App crashed on start (checked 30 seconds too early)
- Deployed on Friday at 5pm (classic)
```

### The CI/CD Pipeline

```
┌────────┐    ┌────────┐    ┌────────┐    ┌─────────┐    ┌──────────┐
│ Source │───▶│ Build  │───▶│  Test  │───▶│ Staging │───▶│Production│
│ (push) │    │        │    │        │    │ Deploy  │    │  Deploy  │
└────────┘    └────────┘    └────────┘    └─────────┘    └──────────┘
     │              │             │             │              │
   Git push    npm install    Unit tests   Deploy to     Deploy to
   to main     npm build      Integration  staging &     production
               Docker build   E2E tests    smoke test    (if staging OK)
```

### Pipeline Principles

| Principle | Why |
|-----------|-----|
| Every commit triggers the pipeline | No "it worked locally" surprises |
| Tests must pass before deploy | Catch bugs before they reach users |
| Identical artifacts across environments | Same Docker image in staging and production |
| Automated rollback | If health check fails → revert automatically |
| No human intervention for standard deploys | Humans only for approvals/emergencies |

---

## 09 — GitHub Actions for EC2 Deployment

### Complete CI/CD Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

env:
  NODE_VERSION: '20'
  EC2_HOST: ${{ secrets.EC2_HOST }}
  EC2_USER: ubuntu
  APP_DIR: /home/ubuntu/app

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run test:integration

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production  # Requires approval if configured

    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: build-output
          path: dist/

      # Configure SSH
      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H ${{ env.EC2_HOST }} >> ~/.ssh/known_hosts

      # Deploy
      - name: Deploy to EC2
        run: |
          # Copy built files to EC2
          rsync -avz --delete \
            -e "ssh -i ~/.ssh/deploy_key" \
            dist/ package.json package-lock.json \
            ${{ env.EC2_USER }}@${{ env.EC2_HOST }}:${{ env.APP_DIR }}/

          # Install deps and restart on EC2
          ssh -i ~/.ssh/deploy_key ${{ env.EC2_USER }}@${{ env.EC2_HOST }} << 'EOF'
            cd ${{ env.APP_DIR }}
            npm ci --only=production
            pm2 reload ecosystem.config.js --update-env
          EOF

      # Verify deployment
      - name: Health Check
        run: |
          sleep 10
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://myapp.com/health)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed! Status: $STATUS"
            # Rollback would go here
            exit 1
          fi
          echo "Deployment successful! Health check returned $STATUS"
```

### Secrets Management in GitHub

```
Repository Settings → Secrets and Variables → Actions

Required secrets:
- EC2_HOST: Your EC2 public IP or domain
- EC2_SSH_KEY: Private SSH key for deployment user
- AWS_ACCESS_KEY_ID: (if using AWS CLI in pipeline)
- AWS_SECRET_ACCESS_KEY: (if using AWS CLI)

Better: Use OIDC (no access keys stored in GitHub)
```

---

## 10 — Blue-Green Deployment

### The Concept

```
BEFORE DEPLOY:
                    ┌──────────┐
Users ──────────────▶   ALB    │──────▶ Blue (v1.0) ← LIVE
                    └──────────┘       Green (v1.1) ← IDLE (being deployed)

AFTER DEPLOY (switch):
                    ┌──────────┐
Users ──────────────▶   ALB    │──────▶ Green (v1.1) ← NOW LIVE
                    └──────────┘       Blue (v1.0) ← IDLE (rollback ready)

ROLLBACK (if needed):
                    ┌──────────┐
Users ──────────────▶   ALB    │──────▶ Blue (v1.0) ← BACK TO LIVE
                    └──────────┘       Green (v1.1) ← IDLE (fix it)
```

### Benefits

| Benefit | Explanation |
|---------|-------------|
| **Zero downtime** | Traffic switches instantly at ALB level |
| **Instant rollback** | Switch back to old environment in seconds |
| **Full testing** | Test new version with real infra before switching |
| **Confidence** | If green works for 5 minutes, you know it's good |

### Implementation with ALB

```bash
# Deploy new version to green target group
# ... (deploy steps here)

# Switch traffic from blue to green
aws elbv2 modify-listener \
  --listener-arn arn:aws:elasticloadbalancing:... \
  --default-actions '[{
    "Type": "forward",
    "TargetGroupArn": "arn:aws:elasticloadbalancing:.../green-tg/..."
  }]'

# If something goes wrong — instant rollback:
aws elbv2 modify-listener \
  --listener-arn arn:aws:elasticloadbalancing:... \
  --default-actions '[{
    "Type": "forward",
    "TargetGroupArn": "arn:aws:elasticloadbalancing:.../blue-tg/..."
  }]'
```

---

## 11 — Environment Management

### The Three-Environment Pattern

```
┌────────────┐     ┌────────────┐     ┌────────────────┐
│    Dev     │────▶│  Staging   │────▶│  Production    │
│            │     │            │     │                │
│ • Feature  │     │ • Mirror   │     │ • Real users   │
│   branches │     │   of prod  │     │ • Real data    │
│ • Fast     │     │ • Same     │     │ • Full scale   │
│   deploys  │     │   infra    │     │ • All alerts   │
│ • Dummy    │     │ • Prod-    │     │ • Backups      │
│   data     │     │   like     │     │                │
│            │     │   data     │     │                │
└────────────┘     └────────────┘     └────────────────┘
```

### Why Environments Must Mirror Each Other

```
"But it worked in staging!"

Common reasons it didn't work in production:
- Staging has 1,000 rows; production has 2,000,000
- Staging uses t3.micro; production uses t3.large (different behavior under load)
- Staging has 1 instance; production has 4 (concurrency bugs)
- Staging talks to sandbox APIs; production talks to real ones
```

### Feature Flags

```javascript
// Instead of deploying features = releasing features
const featureFlags = {
  newCheckoutFlow: {
    enabled: process.env.FF_NEW_CHECKOUT === 'true',
    rolloutPercentage: 10  // Only 10% of users see it
  }
};

// In your code:
if (featureFlags.newCheckoutFlow.enabled) {
  return renderNewCheckout();
} else {
  return renderOldCheckout();
}
```

Benefits:
- Deploy code anytime (flag is off)
- Enable gradually (1% → 10% → 50% → 100%)
- Kill switch: disable instantly without deploying

---

## 12 — Infrastructure as Code (IaC)

### Why Clicking in the Console Doesn't Scale

```
Manual (Console clicking):
- "Who created this security group?"
- "Why does this instance have 32GB RAM?"
- "Can we recreate this environment?"
- "What changed since last week?"
- Answer to all: ¯\_(ツ)_/¯

IaC (Terraform/CloudFormation):
- Every change is code-reviewed
- Git history shows who changed what and when
- Recreate entire environments with one command
- Drift detection shows if someone clicked in console
```

### Terraform Basics

```hcl
# main.tf — Define your infrastructure as code

provider "aws" {
  region = "us-east-1"
}

resource "aws_instance" "app" {
  ami           = "ami-0abc123"
  instance_type = "t3.medium"
  key_name      = "production-key"

  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  tags = {
    Name        = "production-app"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

resource "aws_security_group" "app" {
  name        = "app-sg"
  description = "Allow HTTP and SSH"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    security_groups = [aws_security_group.alb.id]  # Only ALB can reach app
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

```bash
# Terraform workflow
terraform init      # Download providers
terraform plan      # Preview changes (what WILL happen)
terraform apply     # Execute changes (make it happen)
terraform destroy   # Tear everything down
```

### CloudFormation Basics

```yaml
# template.yaml — AWS-native IaC
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Production web application stack'

Resources:
  AppInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-0abc123
      InstanceType: t3.medium
      SecurityGroupIds:
        - !Ref AppSecurityGroup
      Tags:
        - Key: Name
          Value: production-app

  AppSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Allow HTTP from ALB
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 3000
          ToPort: 3000
          SourceSecurityGroupId: !Ref ALBSecurityGroup
```

### Terraform vs CloudFormation

| Factor | Terraform | CloudFormation |
|--------|-----------|----------------|
| Multi-cloud | ✅ AWS, GCP, Azure, etc. | ❌ AWS only |
| Language | HCL (readable) | YAML/JSON (verbose) |
| State management | You manage state file | AWS manages |
| Ecosystem | 🟢 Huge provider ecosystem | 🟡 AWS services only |
| Learning curve | 🟡 Medium | 🟡 Medium |
| AWS integration | Good | 🟢 Native (fastest support) |

---

## 13 — Cost Optimization

### Pricing Models

| Model | Savings | Commitment | Best For |
|-------|---------|-----------|----------|
| **On-Demand** | Baseline (0%) | None | Variable/unpredictable workloads |
| **Reserved (1yr)** | ~30-40% | 1 year | Steady-state production |
| **Reserved (3yr)** | ~50-60% | 3 years | Long-term infrastructure |
| **Savings Plans** | ~30-60% | $/hour commitment | Flexible (any instance type) |
| **Spot Instances** | ~60-90% | None (can be interrupted) | Batch processing, CI/CD, non-critical |

### Typical Web App Monthly Cost Breakdown

| Component | On-Demand | Optimized | Notes |
|-----------|-----------|-----------|-------|
| EC2 (2× t3.medium) | $60 | $38 | Savings Plan |
| RDS (db.t3.medium, Multi-AZ) | $130 | $85 | Reserved |
| ALB | $22 | $22 | No discount available |
| S3 (50GB + transfers) | $5 | $5 | Already cheap |
| CloudWatch | $10 | $10 | Minimal at small scale |
| Data Transfer | $15 | $10 | CloudFront reduces |
| **Total** | **$242/mo** | **$170/mo** | **30% savings** |

### Free Tier Gotchas

| Service | Free Tier | Gotcha |
|---------|-----------|--------|
| EC2 | 750 hrs/mo t2.micro | Only first 12 months! |
| RDS | 750 hrs/mo db.t2.micro | Only first 12 months! |
| S3 | 5GB storage | Data transfer OUT costs money |
| ALB | Not free tier | Starts costing immediately |
| Elastic IP | Free while attached | $3.60/mo if unattached! |
| NAT Gateway | Not free tier | $32/mo just existing + data |

### Cost Optimization Checklist

| # | Action | Savings |
|---|--------|---------|
| 1 | Set billing alarms | 🛡️ Prevention |
| 2 | Right-size instances (use CloudWatch data) | 20-40% |
| 3 | Savings Plans for steady workloads | 30-60% |
| 4 | Spot for batch/CI/CD | 60-90% |
| 5 | S3 lifecycle policies (→ IA → Glacier) | 50-80% on storage |
| 6 | Delete unused EBS volumes and Elastic IPs | 100% of waste |
| 7 | Schedule dev/staging shutdown (nights/weekends) | 65% |
| 8 | CloudFront for static assets | Reduces EC2 load |
| 9 | Use ARM instances (Graviton) | 20% cheaper, often faster |
| 10 | Review monthly with Cost Explorer | Continuous |

---

## 14 — The Evolution Path

### From Single Instance to Production-Grade

```
Stage 1: MVP
┌─────────────────┐
│  Single EC2     │
│  (app + DB)     │  ← Everything on one box
└─────────────────┘
Cost: $20/mo | Risk: 🔴 Total loss if instance dies

Stage 2: Separated DB
┌─────────┐     ┌─────────┐
│  EC2    │────▶│  RDS    │  ← DB is now managed, backed up
│  (app)  │     │  (DB)   │
└─────────┘     └─────────┘
Cost: $80/mo | Risk: 🟡 App dies if EC2 dies, DB safe

Stage 3: Load Balanced
┌─────┐     ┌─────┐
│ EC2 │     │ EC2 │     ┌─────┐
│     │◀────│ ALB │────▶│ RDS │  ← Multiple app instances
│ EC2 │     │     │     │ M-AZ│
└─────┘     └─────┘     └─────┘
Cost: $250/mo | Risk: 🟢 Survives instance failure

Stage 4: Containers
┌──────────┐     ┌──────────┐
│  ECS     │     │  RDS     │
│  Fargate │◀────│  Multi-AZ│  ← No server management
│  (tasks) │     │  + Cache │
└──────────┘     └──────────┘
Cost: $200-400/mo | Risk: 🟢 AWS manages infrastructure

Stage 5: Kubernetes (EKS)
┌──────────────────────┐
│  EKS (Kubernetes)    │  ← Multi-service, multi-team
│  ├── API service     │
│  ├── Worker service  │
│  ├── ML service      │
│  └── Admin service   │
└──────────────────────┘
Cost: $500-2000/mo | Risk: 🟢 Production-grade, complex

Stage 6: Serverless
┌──────────────────────┐
│  API Gateway + Lambda│  ← Pay per request
│  + DynamoDB          │
│  + S3 + SQS         │
└──────────────────────┘
Cost: $0-500/mo (scales to zero) | Risk: 🟢 AWS manages everything
```

### When to Make Each Jump

| From → To | Signal to Upgrade |
|-----------|-------------------|
| Single EC2 → EC2 + RDS | Any production app. Immediately. |
| EC2 + RDS → ALB + ASG | Need high availability OR more than 1 instance |
| ALB + ASG → Containers | Multiple services, team growing, deploy complexity |
| Containers → Kubernetes | 10+ services, multiple teams, complex orchestration |
| Any → Serverless | Event-driven, variable load, want zero ops |

---

## 15 — "What Would Go Wrong If..." Scenarios

### No Health Checks on ALB

```
Scenario:
- Instance (b) runs out of memory, app process crashes
- ALB doesn't know (no health checks configured)
- ALB keeps sending 33% of traffic to dead instance
- Those users see 502 Bad Gateway
- You don't notice for 2 hours

With health checks:
- ALB detects failure in 90 seconds
- Stops sending traffic to instance (b)
- Auto Scaling replaces it in 3 minutes
- Zero user impact
```

### Docker Image Without Non-Root User

```
Scenario:
- Container runs as root (default)
- Vulnerability in your app allows remote code execution
- Attacker now has ROOT access inside the container
- Can read /etc/shadow, install tools, attempt container escape
- If Docker socket is mounted (common mistake) → attacker owns the HOST

With non-root user:
- Attacker gets unprivileged access
- Can't read sensitive files
- Can't install packages
- Container escape much harder
```

### CI/CD Without Tests

```
Week 1:  Push to main → auto-deploys → everything fine
Week 2:  Push breaks login page → auto-deploys → 500 users can't log in
Week 2:  "Why didn't we know?!" → No tests checked login flow
Week 3:  Add tests. Push breaks API endpoint → tests CATCH it → deploy blocked
Week 3:  "See? Tests saved us."
```

### Auto Scaling Min=0

```
Scenario:
- Auto Scaling min=0, scale based on CPU
- Night: zero traffic → scale down to 0 instances
- Morning: first user hits the site
- ALB has no healthy targets → 503 error
- ASG starts scaling up → takes 3-5 minutes (instance boot + app start)
- First 3-5 minutes of morning traffic = errors

Fix: Always set min=1 (or min=2 for HA)
- Alternatively: keep a "warm" instance schedule
```

---

## 16 — Interview Design Question

> **"Your application needs to handle a 10x traffic spike during a flash sale. Design the architecture."**

### Structured Answer

**1. Baseline Architecture:**
- ALB → Auto Scaling Group (min: 4, max: 40) → EC2 fleet
- RDS Multi-AZ (db.r5.xlarge) with read replicas for read-heavy queries
- ElastiCache (Redis) for session store + hot product cache
- S3 + CloudFront for all static assets

**2. Pre-Sale Preparation:**
- Pre-warm ALB (AWS support request — ALBs scale internally)
- Pre-scale ASG to min: 10 before sale starts (no cold-start penalty)
- Add read replicas (scale horizontally for reads)
- Warm the cache with sale products
- Set aggressive CloudFront TTLs on static content

**3. During Sale:**
- Target tracking scaling: CPU 50% target (aggressive — scale early)
- Predictive scaling based on historical patterns
- Circuit breaker on non-essential services (recommendations, analytics)
- Queue write operations (orders → SQS → workers) — decouple from the spike

**4. Resilience:**
- Rate limiting at ALB level (WAF rules)
- Graceful degradation (serve cached product pages if DB overwhelmed)
- Queue-based ordering (accept order into SQS, process async)
- Waiting room / virtual queue for extreme spikes

**5. Monitoring:**
- Pre-built dashboard for the sale
- Alarm thresholds lowered (alert earlier during critical period)
- War room with real-time metrics
- Designated on-call for the sale duration

---

## 17 — Tech Lead Decision: EC2 vs Containers vs Serverless

### Decision Matrix

| Factor | EC2 (Raw) | Containers (ECS/Fargate) | Serverless (Lambda) |
|--------|-----------|--------------------------|---------------------|
| **Control** | 🟢 Full OS access | 🟡 Container-level | 🔴 Runtime only |
| **Ops burden** | 🔴 High (patch, monitor, scale) | 🟡 Medium | 🟢 Minimal |
| **Startup time** | 🔴 Minutes (new instance) | 🟡 Seconds (new task) | ⚠️ Cold starts (100ms-5s) |
| **Cost at steady load** | 🟢 Cheapest (Reserved) | 🟡 Medium | 🔴 Can be expensive |
| **Cost at variable load** | 🔴 Paying for idle | 🟡 Some waste | 🟢 Pay per invocation |
| **Scale to zero** | ❌ No | ❌ No (Fargate min=1) | ✅ Yes |
| **Long-running tasks** | ✅ Unlimited | ✅ Unlimited | ❌ 15 min max |
| **WebSockets** | ✅ Yes | ✅ Yes | ⚠️ Via API Gateway |
| **Team size needed** | Medium-Large | Medium | Small |

### Cost Comparison by Workload

| Workload | EC2 | Fargate | Lambda |
|----------|-----|---------|--------|
| Steady API (1000 req/s, 24/7) | $60/mo ✅ | $100/mo | $300/mo |
| Variable API (100 req/s avg, 1000 peak) | $60/mo (over-provisioned) | $80/mo | $50/mo ✅ |
| Batch job (runs 2 hrs/day) | $60/mo (waste!) | $15/mo | $5/mo ✅ |
| ML inference (GPU, steady) | $400/mo ✅ | N/A | N/A |

### The Recommendation

```
"When should I use what?"

Lambda:
- API endpoints with variable traffic
- Event processing (S3 upload → process → store)
- Cron jobs and scheduled tasks
- Prototypes and MVPs

ECS/Fargate:
- Steady-state web services
- Long-running processes
- Multiple services (microservices)
- Teams who know Docker

EC2:
- Need GPU access
- Need full OS control (compliance)
- Cost optimization at steady scale (Reserved)
- Legacy apps that can't be containerized
```

---

## 18 — The Startup-to-Enterprise Infrastructure Journey

| Stage | Infra | Team | Monthly Cost | Key Decision |
|-------|-------|------|-------------|-------------|
| **Hackathon** | Heroku / Railway | 1-2 devs | $7-25 | Ship fast, worry later |
| **MVP** | Single EC2 + RDS | 2-4 devs | $50-100 | Validate the idea first |
| **Growth** | ALB + ASG + RDS Multi-AZ | 5-10 devs | $200-500 | First "real" architecture |
| **Scale** | ECS + RDS + ElastiCache + S3 | 10-20 devs | $1K-5K | Containers, CI/CD, IaC |
| **Enterprise** | EKS + Multi-account + IaC | 20-100 devs | $5K-50K | Platform team, governance |
| **Hyperscale** | Multi-region + custom | 100+ devs | $50K+ | Dedicated infra team |

### Signs You Need to Level Up

| If you're experiencing... | You need to move to... |
|--------------------------|----------------------|
| "I SSHed into prod and ran the deploy" | CI/CD pipeline |
| "The site was down because the instance died" | ALB + ASG (high availability) |
| "Deploying takes 30 minutes and is scary" | Containers + blue-green |
| "We can't deploy because Team B is deploying" | Microservices / independent services |
| "Our AWS bill doubled and we don't know why" | IaC + cost monitoring + tagging |
| "Staging doesn't match production" | IaC (Terraform) + environment parity |

---

## 19 — Complete Architecture: Putting It All Together

### The Full Production Stack

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  CloudFront (CDN)                                       │
│  - Static assets (JS, CSS, images)                      │
│  - Cache API responses (where appropriate)              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Application Load Balancer (ALB)                        │
│  - SSL termination                                      │
│  - Path-based routing (/api, /admin, /health)           │
│  - Health checks every 30s                              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Auto Scaling Group (min:2, max:10)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  EC2/ECS │  │  EC2/ECS │  │  EC2/ECS │              │
│  │  (app)   │  │  (app)   │  │  (app)   │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
└───────┼──────────────┼──────────────┼───────────────────┘
        │              │              │
        ▼              ▼              ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────────┐
│ RDS Multi-AZ  │  │ ElastiCache   │  │ S3                │
│ (PostgreSQL)  │  │ (Redis)       │  │ (uploads, assets) │
│               │  │               │  │                   │
│ Primary +     │  │ Sessions      │  │ Pre-signed URLs   │
│ Standby +     │  │ Cache         │  │ Lifecycle policies│
│ Read Replica  │  │ Rate limiting │  │ Versioning        │
└───────────────┘  └───────────────┘  └───────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Supporting Services                                      │
│  ├── Secrets Manager (DB creds, API keys)                 │
│  ├── CloudWatch (metrics, logs, alarms)                   │
│  ├── SNS (alert notifications)                            │
│  ├── SQS (async job queue)                                │
│  └── CloudTrail (audit log)                               │
└───────────────────────────────────────────────────────────┘
```

### CI/CD Flow

```
Developer pushes to main
         │
         ▼
┌─────────────────┐
│  GitHub Actions  │
│  1. Lint         │
│  2. Test         │
│  3. Build Docker │
│  4. Push to ECR  │
│  5. Deploy to    │
│     ECS/EC2      │
│  6. Health check │
│  7. Notify Slack │
└─────────────────┘
```

---

## 20 — Summary

| Topic | Key Takeaway |
|-------|-------------|
| S3 | Object storage. Uploads go here, NEVER on EC2 disk. |
| ALB | Distributes traffic. Enables scaling + zero-downtime. |
| Auto Scaling | Automatically adds/removes instances based on rules. |
| Docker | Same image everywhere. Eliminates "works on my machine." |
| ECS/Fargate | Container orchestration. Serverless containers. |
| CI/CD | Code → Test → Build → Deploy. No manual SSH. |
| Blue-Green | Zero-downtime deploys with instant rollback. |
| IaC | Infrastructure as code. Reproducible, reviewable, version-controlled. |
| Cost Optimization | Reserved Instances, right-sizing, lifecycle policies. |
| Evolution | Single EC2 → ALB + ASG → Containers → Serverless |

> **The mindset shift:** Junior engineers think about getting code to work. Senior engineers think about keeping it working — at scale, with zero downtime, automatically, affordably, and with the ability to roll back in seconds when things go wrong. That's what this entire file is about.
