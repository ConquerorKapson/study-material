---
title: "Phase 13 — Docker, ECR, Kubernetes & EKS"
description: "Containerize your app, push to AWS Elastic Container Registry, orchestrate with Kubernetes, and run a production-grade EKS cluster — concepts, architecture, and hands-on walkthrough."
order: 13
---

# Phase 13 — Docker, ECR, Kubernetes & EKS

> **Category:** Infrastructure · **Difficulty:** Advanced · **Related:** EC2 · CI/CD · Load Balancers · IAM

---

## 01 — Why Docker Exists

```
Developer's laptop:   Node 20, Ubuntu 22   → works fine
EC2 production:       Node 18, Ubuntu 24   → crashes
Teammate's machine:   Node 22, macOS       → different behavior

"It works on my machine" → the most expensive phrase in engineering
```

Docker packages your app **and its entire environment** into one unit.

```
Docker Image = your code
             + Node.js 20
             + all npm packages
             + OS libraries
             + environment config
             = one file that runs identically everywhere
```

> **Interview crux:** Docker doesn't just bundle code — it bundles the runtime, system libraries, and config. The container is isolated from the host OS, so version drift and dependency conflicts are eliminated.

---

## 02 — Core Docker Concepts

| Concept | What it is |
|---------|-----------|
| **Dockerfile** | Recipe: instructions for building an image |
| **Image** | Immutable snapshot — the built artifact |
| **Container** | A running instance of an image |
| **Registry** | Storage warehouse for images (Docker Hub, ECR) |
| **Layer** | Each Dockerfile instruction = one cacheable layer |
| **Tag** | Version label on an image (`v1.0`, `latest`) |
| **Volume** | Persistent storage mounted into a container |

**Image vs Container analogy:**
- Image = a class definition
- Container = an instantiated object

---

## 03 — Dockerfile Deep Dive

```dockerfile
# ── Stage 1: Dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy ONLY package files first (better layer caching)
# If package.json doesn't change, this layer is cached
COPY package.json package-lock.json ./
RUN npm ci --production=false

# ── Stage 2: Builder ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the production bundle
ENV NODE_ENV=production
RUN npm run build

# ── Stage 3: Production runner (smallest possible image) ──────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Only copy what's needed to run (not dev deps, not source)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "server.js"]
```

### Why multi-stage builds?

```
Single stage:  image = 1.2 GB (includes build tools, dev deps, source maps)
Multi-stage:   image = 180 MB (only runtime code + node_modules needed to run)
```

**Layer caching explained:**
```
COPY package.json .    ← layer 1 (cached if package.json unchanged)
RUN npm ci             ← layer 2 (only re-runs if layer 1 changed)
COPY . .               ← layer 3 (changes every commit)
RUN npm run build      ← layer 4 (re-runs every commit, but layers 1-2 cached)
```

Order your Dockerfile from least-changing to most-changing to maximize cache hits.

---

## 04 — ECR — Elastic Container Registry

AWS's private Docker image registry. Think Docker Hub but inside your AWS account.

```
Your machine                        AWS ECR
──────────────────                  ─────────────────────────
docker build                   →    123456789.dkr.ecr.ap-south-1.amazonaws.com/
docker tag image:latest             signal-garden:latest
docker push                         signal-garden:v1.0.0
                                     signal-garden:v1.0.1
                                     signal-garden:latest
                                              │
                                              │ pull (IAM auth)
                                              ▼
                                     EKS / ECS / EC2
```

### Why ECR over Docker Hub:

| | Docker Hub | ECR |
|---|---|---|
| Privacy | Public by default | Private by default |
| Auth | Username + password | IAM roles (no passwords) |
| Network | Public internet | Same-region = fast + free |
| Scanning | Paid | Built-in vulnerability scanning |
| Integration | Manual | Native with EKS, ECS, CodeBuild |

### ECR Authentication Flow:

```bash
# Get a temporary Docker login token from ECR (valid 12 hours)
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin \
    123456789.dkr.ecr.ap-south-1.amazonaws.com

# Now push as normal
docker push 123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:latest
```

> **Learning point:** ECR uses AWS SigV4 auth. The `get-login-password` command hits the AWS API with your IAM credentials and returns a short-lived Docker registry password. The actual image pull/push then happens over HTTPS with that token. No long-lived passwords in config files.

---

## 05 — Kubernetes Architecture

### The problem Kubernetes solves:

You have 10 containers to run. Questions arise:
- Which server runs which container?
- What if a container crashes?
- What if an entire server dies?
- How do you update to a new version without downtime?
- How do you scale when traffic spikes?

Kubernetes answers all of these.

### Cluster Architecture:

```
┌─── KUBERNETES CLUSTER ──────────────────────────────────────────────┐
│                                                                       │
│  ┌── Control Plane (the brain) ──────────────────────────────────┐  │
│  │                                                                 │  │
│  │  API Server   ← all kubectl commands hit here                 │  │
│  │  Scheduler    ← decides which node runs which pod             │  │
│  │  Controller   ← watches desired vs actual state, fixes drift  │  │
│  │  etcd         ← cluster's source of truth (key-value store)   │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                         │
│         ┌────────────────────┼────────────────────┐                   │
│         ▼                    ▼                    ▼                    │
│  ┌── Node 1 ────┐    ┌── Node 2 ────┐    ┌── Node 3 ────┐           │
│  │  (EC2 t3.med)│    │  (EC2 t3.med)│    │  (EC2 t3.med)│           │
│  │              │    │              │    │              │           │
│  │  Pod         │    │  Pod  Pod    │    │  Pod         │           │
│  │  [container] │    │  [c]  [c]    │    │  [container] │           │
│  │              │    │              │    │              │           │
│  │  kubelet     │    │  kubelet     │    │  kubelet     │           │
│  │  (node agent)│    │  (node agent)│    │  (node agent)│           │
│  └──────────────┘    └──────────────┘    └──────────────┘           │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Core Kubernetes Objects:

| Object | Purpose | Analogy |
|--------|---------|---------|
| **Pod** | Smallest unit — one or more containers | A running process |
| **Deployment** | "Run N replicas of this pod, always" | A process supervisor |
| **Service** | Stable DNS + IP for a set of pods | A load balancer |
| **Ingress** | HTTP routing rules (path-based, host-based) | NGINX config |
| **ConfigMap** | Non-sensitive config/env vars | `.env` file |
| **Secret** | Encrypted sensitive config | `.env.local` file |
| **Namespace** | Virtual cluster separation | A folder |
| **HPA** | Horizontal Pod Autoscaler — scale replicas by CPU/memory | Auto-scaling policy |

### The Desired State Model:

```
You:        "I want 3 replicas of signal-garden always running"
            kubectl apply -f deployment.yml

Kubernetes: Stores this in etcd as desired state.
            Scheduler: places 3 pods on available nodes.

Pod crashes on Node 2:
            Controller detects: actual=2, desired=3
            Scheduler: creates replacement pod on Node 1 or 3
            Time to recovery: ~5-10 seconds. Automatic.

Node 2 dies entirely:
            Controller detects: 2 pods lost
            Scheduler: creates 2 replacement pods on surviving nodes
            Your traffic routes away from Node 2 automatically
```

---

## 06 — EKS — Elastic Kubernetes Service

Kubernetes requires you to manage the control plane (API server, etcd, scheduler). This is complex, critical, and must be highly available. EKS manages it for you.

```
Without EKS:
  You: install K8s control plane on VMs
  You: secure etcd
  You: configure HA (3 control plane nodes)
  You: manage K8s version upgrades
  You: patch security vulnerabilities
  Cost: significant engineering time + ops burden

With EKS:
  AWS: runs and manages the control plane
  AWS: handles HA, etcd backups, control plane upgrades
  You: manage worker nodes (or use Fargate for those too)
  Cost: $0.10/hour (~₹600/month) for the managed control plane
```

### Node Options:

| Option | What it is | When to use |
|--------|-----------|-------------|
| **Managed Node Groups** | EC2 instances you control, AWS automates provisioning | Most workloads |
| **Self-Managed Nodes** | Full control over EC2 config | Custom AMIs needed |
| **AWS Fargate** | Serverless — no nodes to manage | Bursty, small workloads |

---

## 07 — The Complete Signal Garden Deployment Architecture

```
Developer pushes to main
         │
         ▼
GitHub Actions runner:
  1. docker build → creates image
  2. aws ecr get-login-password | docker login
  3. docker push → 123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:abc123
  4. kubectl set image deployment/signal-garden signal-garden=...ecr.../signal-garden:abc123
         │
         ▼
EKS Cluster (ap-south-1):
         │
         ├── Deployment: signal-garden
         │     spec.replicas: 2
         │     image: ECR image
         │     envFrom: Secret/signal-garden-secrets
         │          │
         │          ├── Pod 1 (Node A) → container → Next.js :3000
         │          └── Pod 2 (Node B) → container → Next.js :3000
         │
         ├── Service: signal-garden-svc (type: LoadBalancer)
         │     → AWS provisions an ALB automatically
         │     → Routes to healthy pods
         │     → signal-garden.fun (DNS → ALB)
         │
         └── Secret: signal-garden-secrets
               DATABASE_URL=postgresql://...@rds-endpoint.../signal_garden
               CLERK_SECRET_KEY=sk_live_...
               (base64 encoded, encrypted at rest in etcd)
                        │
                        ▼
              RDS PostgreSQL (unchanged)
              Same database as before
```

---

## 08 — Kubernetes Manifests Explained

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: signal-garden
  namespace: production
spec:
  replicas: 2                          # Always keep 2 pods running
  selector:
    matchLabels:
      app: signal-garden
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0                # Never kill old pod before new one is ready
      maxSurge: 1                      # Spin up 1 extra pod during update
  template:
    metadata:
      labels:
        app: signal-garden
    spec:
      containers:
        - name: signal-garden
          image: 123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: signal-garden-secrets
          resources:
            requests:
              cpu: "250m"              # 0.25 vCPU guaranteed
              memory: "256Mi"
            limits:
              cpu: "500m"              # max 0.5 vCPU
              memory: "512Mi"
          readinessProbe:              # Pod only receives traffic when ready
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:               # Restart pod if it becomes unhealthy
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 15
```

### Rolling Update — Zero Downtime Deploy:

```
Before update:   Pod-v1  Pod-v1   (both serving traffic)
                       │
Start update:    Pod-v1  Pod-v1  Pod-v2-starting
                                  (maxSurge: 1)
                       │
v2 is ready:     Pod-v1  Pod-v1  Pod-v2-ready
                       │
Kill one v1:     Pod-v1          Pod-v2-ready
                       │
v2 #2 starts:    Pod-v1  Pod-v2-starting  Pod-v2-ready
                       │
Kill last v1:            Pod-v2  Pod-v2
                       │
Done:            Pod-v2  Pod-v2  (zero downtime!)
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: signal-garden-svc
spec:
  type: LoadBalancer       # AWS auto-provisions an ALB
  selector:
    app: signal-garden     # routes to pods with this label
  ports:
    - port: 80
      targetPort: 3000
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: signal-garden-secrets
type: Opaque
data:
  # Values must be base64 encoded:
  # echo -n "value" | base64
  DATABASE_URL: cG9zdGdyZXNxbDovLy4uLg==
  CLERK_SECRET_KEY: c2tfdGVzdF8uLi4=
```

> **Learning point:** Kubernetes Secrets are base64-encoded (NOT encrypted) by default. For real security, use AWS Secrets Manager + External Secrets Operator, or enable etcd encryption at rest in EKS.

---

## 09 — kubectl Cheat Sheet

```bash
# Context / cluster
kubectl config get-contexts          # list clusters
kubectl config use-context <name>    # switch cluster

# Deploy
kubectl apply -f deployment.yml      # create/update resources
kubectl delete -f deployment.yml     # delete resources

# Observe
kubectl get pods -n production       # list pods
kubectl get pods -w                  # watch pods live
kubectl describe pod <pod-name>      # full pod details + events
kubectl logs <pod-name>              # stdout logs
kubectl logs <pod-name> -f           # tail logs
kubectl logs <pod-name> --previous   # logs from crashed pod

# Exec
kubectl exec -it <pod-name> -- sh    # shell into a pod

# Scale
kubectl scale deployment signal-garden --replicas=5

# Update image (triggers rolling update)
kubectl set image deployment/signal-garden \
  signal-garden=<ecr-repo>:new-tag

# Rollback
kubectl rollout undo deployment/signal-garden

# History
kubectl rollout history deployment/signal-garden
```

---

## 10 — Updated CI/CD Pipeline (GitHub Actions → ECR → EKS)

```yaml
name: Deploy to EKS

on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-south-1
  ECR_REPOSITORY: signal-garden
  EKS_CLUSTER: signal-garden-cluster

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push image
        id: build
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Update kubeconfig
        run: |
          aws eks update-kubeconfig \
            --region ${{ env.AWS_REGION }} \
            --name ${{ env.EKS_CLUSTER }}

      - name: Deploy to EKS
        env:
          IMAGE: ${{ steps.build.outputs.image }}
        run: |
          kubectl set image deployment/signal-garden \
            signal-garden=$IMAGE \
            -n production
          kubectl rollout status deployment/signal-garden -n production
```

**What each step does:**
1. `configure-aws-credentials` — sets up IAM auth in CI runner
2. `amazon-ecr-login` — gets temp Docker token for ECR
3. `docker build/push` — creates image tagged with git SHA (unique, traceable)
4. `update-kubeconfig` — downloads K8s cluster credentials from EKS
5. `kubectl set image` — triggers rolling update in cluster
6. `rollout status` — waits and verifies update succeeded (fails CI if pods crash)

---

## 11 — Key Concepts Summary

| Concept | One-liner |
|---------|-----------|
| Docker image | Immutable snapshot of app + dependencies + OS libraries |
| Docker container | Running instance of an image |
| Multi-stage build | Separate build from runtime — smaller, safer production image |
| ECR | AWS-native private registry, IAM auth, same-region fast pulls |
| Pod | K8s smallest unit — one or more containers on same node |
| Deployment | Desired state declaration — "always keep N replicas running" |
| Service | Stable endpoint that load-balances across pods |
| Rolling update | Replace pods one-by-one — zero downtime deploy |
| EKS | AWS-managed K8s control plane — you manage workers, AWS manages brain |
| kubectl | CLI to talk to K8s API server |
| Desired state | K8s core philosophy: declare what you want, K8s ensures it always matches |

---

## 12 — Cost Estimate (ap-south-1)

| Component | Cost |
|-----------|------|
| EKS Control Plane | $0.10/hour (~₹600/month) |
| Worker Nodes (2× t3.medium) | ~$0.05/hour each (~₹600/month total) |
| ECR Storage | $0.10/GB/month (negligible) |
| ALB | ~$0.008/hour + data (~₹500/month) |
| **Total** | **~₹1,700-2,000/month** |

> For learning, spin up the cluster, experiment, then `eksctl delete cluster` to stop billing. EKS is not free-tier eligible.
