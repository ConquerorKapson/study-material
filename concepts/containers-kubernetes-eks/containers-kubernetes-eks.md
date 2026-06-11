---
title: "Containers & Kubernetes — From Scratch"
description: "Docker, ECR, Kubernetes objects, and EKS in precise bite-sized sections. Mental models, key distinctions, cheat sheets, and interview callouts — everything you need to reason about containers in real-world systems."
order: 4
---

# Containers & Kubernetes — From Scratch

> **Category:** Infrastructure · **Difficulty:** Advanced · **Related:** [Containers, Kubernetes & EKS — The Complete Story](/concepts/containers-kubernetes-eks-complete) · EC2 · IAM · CI/CD

---

## 01 — TLDR

- Docker packages your app **and its runtime** into one artifact — eliminates environment drift
- A Docker image is a **stack of cached layers** — order your Dockerfile from least-to-most-changing
- Multi-stage builds keep production images small and safe (strip build tools from the final image)
- ECR = AWS private registry, uses **IAM auth** (no passwords — temporary tokens derived from your IAM identity)
- Kubernetes runs on the **desired state model**: you declare what you want, it reconciles continuously
- A **Pod** is a running container instance; a **Deployment** ensures N pods always run (it restarts, replaces, scales)
- A **Service** is a stable DNS name and virtual IP that routes traffic to healthy pods (pods are ephemeral, Services aren't)
- **Rolling updates** with `maxUnavailable: 0` guarantee zero downtime — readiness probe is the gating mechanism
- **EKS** is Kubernetes with AWS managing the control plane (etcd, API server, scheduler) — you manage workers
- **IRSA** lets pods assume IAM roles without storing AWS credentials anywhere in the cluster

**Elevator pitch:** Containers solve packaging. Kubernetes solves scheduling, healing, scaling, and deployment. EKS makes Kubernetes production-grade without the control plane burden. Together they form the backbone of modern cloud-native infrastructure.

---

## 02 — Docker Mental Model

### The Core Problem

```
Without containers: code ships separately from its runtime
  → Runtime versions drift between dev, staging, prod
  → "Works on my machine" is the symptom

With containers: code + runtime ship together
  → One image runs identically everywhere
  → Environment drift is eliminated by design
```

### Image vs Container vs Registry

| Concept | What it is | Analogy |
|---------|-----------|---------|
| **Image** | Immutable snapshot of app + OS + runtime | A class definition |
| **Container** | A running instance of an image | An object (instantiated class) |
| **Registry** | Storage for images (ECR, Docker Hub) | npm registry, but for images |
| **Tag** | Version label on an image (`v1.0`, `sha-abc123`) | npm version |

### Layer Caching — The Most Impactful Rule

```
Dockerfile layers are cached by content hash.
If a layer's input changes → that layer AND every layer below it must rebuild.

❌ Wrong order:
COPY . .              ← changes every commit → cache miss every commit
RUN npm ci            ← re-runs EVERY build (minutes lost per commit)

✅ Right order:
COPY package.json .   ← rarely changes → usually cache hit
RUN npm ci            ← only runs when package.json changes
COPY . .              ← changes every commit, but npm ci is already cached
```

### Multi-Stage Build

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner      ← fresh base, nothing from builder
WORKDIR /app
COPY --from=builder /app/.next/standalone ./    ← copy only what runs
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

**Why it matters:**

| | Single stage | Multi-stage |
|---|---|---|
| Image size | ~1.2 GB (includes TypeScript, devDeps, source) | ~180 MB (runtime only) |
| Attack surface | Includes build tools attacker can leverage | Minimal — no compiler, no npm |
| Layer cache benefit | Partial | Full — builder cached, runner is tiny |

---

## 03 — ECR — Private Container Registry

### Why ECR Over Docker Hub

| | Docker Hub | ECR |
|---|---|---|
| Default visibility | Public | Private |
| Auth | Username + password | IAM roles (no long-lived credentials) |
| Network cost | Public internet | Same-region: free + fast |
| Vulnerability scanning | Paid | Built-in |
| EKS integration | Manual | Native (node IAM role handles auth) |

### Authentication Flow

```bash
# Step 1: Exchange IAM credentials for a time-limited Docker token
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin \
    123456789.dkr.ecr.ap-south-1.amazonaws.com
# Token valid for 12 hours. No password in config files.

# Step 2: Tag your image with the ECR repository URI
docker tag signal-garden:latest \
  123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:${GIT_SHA}

# Step 3: Push (only changed layers are uploaded)
docker push 123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:${GIT_SHA}
```

> **Interview callout:** Tag images with git commit SHA, not `latest`. `latest` is mutable — you can't tell which version is running. SHA tags are immutable and traceable. CI/CD pipelines can roll back to any previous SHA.

---

## 04 — Kubernetes Mental Model

### Desired State Reconciliation — The Core Philosophy

```
You don't say: "Start a container on Node 2"
You say:       "I want 3 replicas of this app always running"

Kubernetes stores that desire in etcd.
A controller loop runs every few seconds:
  If actual < desired → schedule more pods
  If actual > desired → kill excess pods
  If pod crashes     → schedule replacement immediately (~10 seconds)
  If node dies       → move pods to surviving nodes automatically
```

This is why Kubernetes is "self-healing" — not magic, just a tight reconciliation loop.

### Cluster Architecture

```
┌── Control Plane (AWS manages in EKS) ─────────────────────────┐
│  kube-apiserver    ← all kubectl commands land here            │
│  etcd              ← cluster's source of truth (key-value)     │
│  kube-scheduler    ← decides which node gets which pod         │
│  controller-manager ← watches desired vs actual, fixes gaps    │
└────────────────────────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼──────────────────────┐
         ▼                     ▼                       ▼
   ┌── Node 1 ─┐        ┌── Node 2 ─┐         ┌── Node 3 ─┐
   │ (EC2)     │        │ (EC2)     │         │ (EC2)     │
   │ kubelet   │        │ kubelet   │         │ kubelet   │
   │ kube-proxy│        │ kube-proxy│         │ kube-proxy│
   │ Pods      │        │ Pods      │         │ Pods      │
   └───────────┘        └───────────┘         └───────────┘
```

---

## 05 — Key Kubernetes Objects

### Quick Reference

| Object | What it does | When you use it |
|--------|-------------|-----------------|
| **Pod** | Smallest unit — runs one or more containers | Almost never directly — use Deployment |
| **Deployment** | Ensures N pod replicas always run; manages updates | Every application |
| **Service** | Stable DNS + IP that routes to healthy pods | Every application |
| **Ingress** | HTTP/HTTPS routing rules (path, host-based) | Multi-service or TLS termination |
| **ConfigMap** | Non-sensitive config injected as env vars or files | DB host, feature flags, timeouts |
| **Secret** | Sensitive config (base64-encoded in etcd) | Passwords, API keys, TLS certs |
| **HPA** | Auto-scale replica count based on CPU/memory/custom metrics | Variable traffic workloads |
| **Namespace** | Virtual cluster isolation within a cluster | Environment separation (prod/staging) |

### Deployment — The Key Spec Fields

```yaml
spec:
  replicas: 2                         # desired replica count
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0               # zero downtime: never kill before new is ready
      maxSurge: 1                     # allow 1 extra pod during update
  template:
    spec:
      containers:
        - name: signal-garden
          image: <ecr-repo>:abc123    # always use immutable tags (git SHA)
          resources:
            requests: { cpu: "250m", memory: "256Mi" }    # scheduler uses this
            limits:   { cpu: "500m", memory: "512Mi" }    # OOMKill threshold
          readinessProbe:             # gates traffic — fail = removed from Service
            httpGet: { path: /api/health, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:              # gates life — fail = container restarted
            httpGet: { path: /api/health, port: 3000 }
            initialDelaySeconds: 30
            periodSeconds: 15
```

### Readiness vs Liveness — Critical Distinction

| Probe | What it answers | Failure consequence |
|-------|----------------|---------------------|
| **Readiness** | Is this pod ready to receive traffic? | Removed from Service endpoints (not killed) |
| **Liveness** | Is this pod alive and not deadlocked? | Container is killed and restarted |

A pod can be live-but-not-ready (warming up) — stays running, gets no traffic.
A pod that fails liveness gets killed — used for deadlock/hang detection.

### Service Types

```yaml
spec:
  type: LoadBalancer   # Creates an AWS ALB automatically
  selector:
    app: signal-garden
  ports:
    - port: 80
      targetPort: 3000
```

| Type | Access scope | Notes |
|------|-------------|-------|
| `ClusterIP` | Internal only | Default. Backend-to-backend calls |
| `NodePort` | Cluster nodes | Exposes port on every node. Dev/testing |
| `LoadBalancer` | External | AWS provisions ALB. Production entry point |

### Secrets — The Important Caveat

```
Kubernetes Secrets are base64-encoded, NOT encrypted by default.

echo "sk_live_abc123" | base64  →  c2tfdGVzdF8uLi4=
echo "c2tfdGVzdF8uLi4=" | base64 -d  →  sk_live_abc123

Anyone with RBAC permission to GET secrets can decode them.

Production pattern:
  Option 1: Enable etcd encryption at rest (KMS key in EKS)
  Option 2: External Secrets Operator + AWS Secrets Manager
            → Actual values never stored in cluster state
            → ESO fetches from Secrets Manager at pod creation time
```

---

## 06 — EKS — AWS-Managed Kubernetes

### What EKS Gives You

```
Without EKS: YOU manage
  ├── etcd HA cluster (3 or 5 nodes for quorum)
  ├── kube-apiserver behind a load balancer
  ├── Certificate rotation for all control plane TLS
  ├── Control plane version upgrades (complex, version-by-version)
  └── etcd backups (losing etcd = losing the cluster)

With EKS ($0.10/hour): AWS manages ALL of the above
  You manage:
  ├── Worker nodes (EC2 instances — your bill)
  ├── Application deployments
  ├── Kubernetes add-ons (metrics-server, ALB controller)
  └── IAM bindings (IRSA for pod-level AWS access)
```

### Node Options

| Option | Description | Use when |
|--------|-------------|---------|
| **Managed Node Groups** | EC2 with automated AMI updates and scaling | Most workloads |
| **Self-Managed Nodes** | Full EC2 control, custom AMIs | Custom OS requirements |
| **Fargate** | Serverless — no nodes at all | Bursty/small workloads, no ops overhead |

### IRSA — How Pods Access AWS Without Credentials

```
Problem: A pod needs to read from S3 or Secrets Manager
Wrong:   Put AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in a Kubernetes Secret
Right:   IRSA — IAM Role bound to a Kubernetes Service Account

Flow:
  1. Create IAM role with OIDC trust policy:
     "EKS cluster's OIDC provider can assume this role
      IF the requester is Service Account 'signal-garden-sa'"

  2. Annotate the Service Account:
     eks.amazonaws.com/role-arn: arn:aws:iam::123:role/signal-garden-role

  3. Pod spec uses that service account

  4. At runtime: kubelet injects OIDC token → AWS SDK exchanges for temp creds
     → No static credentials anywhere in the cluster
     → Credentials auto-refresh every hour
```

---

## 07 — Zero-Downtime Deployment Walkthrough

```
Initial state: [v1-pod] [v1-pod]   (serving traffic)

kubectl set image deployment/signal-garden signal-garden=repo:v2

Rolling update steps:
  1. Start new pod with v2                →  [v1] [v1] [v2-starting]
  2. v2 passes readiness probe (10-30s)  →  [v1] [v1] [v2-ready]
  3. Remove one v1 from Service          →  [v1] [v2-ready]
  4. Terminate v1 pod                    →  [v2-new-starting] [v2-ready]
  5. New v2 pod passes readiness         →  [v2] [v2]

Zero downtime because:
  → maxUnavailable: 0 → old pods only die after new ones are ready
  → Readiness probe gates traffic → bad deploy never routes traffic
  → kubectl rollout status fails CI → engineer is alerted, old pods still live
```

### Rollback

```bash
kubectl rollout undo deployment/signal-garden          # previous version
kubectl rollout undo deployment/signal-garden --to-revision=3   # specific revision
kubectl rollout history deployment/signal-garden       # see revision history
```

---

## 08 — CI/CD Pipeline: git push → Production

```yaml
# GitHub Actions: .github/workflows/deploy.yml

- name: Login to ECR
  uses: aws-actions/amazon-ecr-login@v2

- name: Build and push
  run: |
    docker build -t $ECR_REPO:${{ github.sha }} .
    docker push $ECR_REPO:${{ github.sha }}

- name: Update kubeconfig
  run: aws eks update-kubeconfig --name signal-garden-cluster --region ap-south-1

- name: Deploy
  run: |
    kubectl set image deployment/signal-garden \
      signal-garden=$ECR_REPO:${{ github.sha }} -n production
    kubectl rollout status deployment/signal-garden -n production
    # ↑ Waits. If pods crash/never-ready → non-zero exit → CI fails
    # Old pods are still running while this waits → safe
```

**Pipeline safety guarantees:**
1. Image tagged with immutable git SHA — always traceable
2. `rollout status` acts as deployment health gate — blocks merge/notify if broken
3. Old pods only terminated after new pods pass readiness — no traffic gap
4. On failure: `kubectl rollout undo` restores previous state in seconds

---

## 09 — kubectl Cheat Sheet

```bash
# Cluster context
kubectl config get-contexts                    # list available clusters
kubectl config use-context <name>              # switch cluster

# Apply / inspect
kubectl apply -f manifest.yml                  # create or update
kubectl get pods -n production -w              # watch pods live
kubectl describe pod <pod-name> -n production  # full details + events
kubectl logs <pod-name> -n production -f       # tail logs
kubectl logs <pod-name> --previous             # logs from last crash

# Exec into a pod
kubectl exec -it <pod-name> -- sh

# Scale
kubectl scale deployment signal-garden --replicas=5

# Update image (triggers rolling update)
kubectl set image deployment/signal-garden \
  signal-garden=<ecr-repo>:new-tag -n production

# Rollback
kubectl rollout undo deployment/signal-garden
kubectl rollout history deployment/signal-garden

# Debug
kubectl get events -n production --sort-by='.lastTimestamp'
kubectl top pods -n production          # requires metrics-server
kubectl top nodes
```

---

## 10 — Cost Reference (ap-south-1)

| Component | What you pay for | Approximate cost |
|-----------|-----------------|-----------------|
| EKS Control Plane | Per cluster per hour | $0.10/hr (~₹600/mo) |
| Worker Nodes | EC2 instance hours | t3.medium: ~$0.05/hr each |
| ECR Storage | GB stored | $0.10/GB/month |
| ALB (LoadBalancer Service) | Per ALB + data processed | ~₹500/mo |
| **Minimum viable cluster** | 1 control plane + 2× t3.medium | **~₹1,700-2,000/mo** |

> **For learning:** `eksctl create cluster` to start, `eksctl delete cluster` when done. EKS billing stops only when the control plane is deleted — not when nodes are stopped.

---

## 11 — Key Concept Summary

| Concept | One-liner |
|---------|-----------|
| Docker image | Immutable artifact: app + runtime + OS libs — eliminates environment drift |
| Layer caching | Dockerfile ordering determines CI build speed — least-to-most-changing |
| Multi-stage build | Build env ≠ runtime env. Strip build tools from production image |
| ECR | AWS private registry with IAM-based auth — no credentials to store |
| Desired state | Declare what you want; K8s reconciles actual state continuously |
| Pod | Running container instance — ephemeral, gets new IP on every restart |
| Deployment | Ensures N replicas always run — self-heals crashes, manages rolling updates |
| Service | Stable virtual IP + DNS for a set of pods — survives pod restarts |
| Rolling update | `maxUnavailable: 0` + readiness probe = zero-downtime deploy |
| EKS | AWS manages control plane; you manage workers, deployments, IAM |
| IRSA | Pods assume IAM roles via OIDC — zero static credentials in cluster |
