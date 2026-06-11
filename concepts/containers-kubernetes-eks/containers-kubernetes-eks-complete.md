---
title: "Containers, Kubernetes & EKS — The Complete Story"
description: "End-to-end deep dive: why Docker exists, how images are built and stored, Kubernetes architecture from first principles, EKS managed control plane, rolling deployments, and the full CI/CD path from git push to production pod."
order: 5
---

# Containers, Kubernetes & EKS — The Complete Story
### From "it works on my machine" to production-grade orchestrated deployments

> **Category:** Infrastructure · **Difficulty:** Advanced · **Related:** [Containers & Kubernetes — From Scratch](/concepts/containers-kubernetes-eks) · EC2 · IAM · CI/CD

> **Prerequisite:** Read [Containers & Kubernetes — From Scratch](/concepts/containers-kubernetes-eks) first for the building blocks. This article connects everything end-to-end and goes deep on every mechanism.

---

## Chapter 0 — The Problem Containers Solve (Really)

Before Docker, deploying software meant managing **environment parity** as a continuous, manual, failure-prone effort.

```
Developer's machine:   Node 20.x, Ubuntu 22.04, npm 10.2, openssl 3.0
Staging server:        Node 18.x, Ubuntu 20.04, npm 9.8,  openssl 1.1
Production server:     Node 18.x, Amazon Linux 2, npm 9.6, openssl 1.1

Symptom: "Works in dev, fails in staging, fails differently in prod"
Root cause: not a bug in your code — a difference in the runtime
Fix: manually synchronize environments, document it in a runbook nobody reads
```

This is not a process problem. It is a **packaging problem**. The code and its runtime were shipped separately.

### What Docker Actually Packages

```
Docker Image = application code
             + language runtime (Node 20, exact version)
             + system libraries (glibc, openssl, exact versions)
             + OS-level dependencies (alpine base, musl libc)
             + environment config (NODE_ENV=production)
             = one artifact, runs identically everywhere
```

The container does not run inside a VM. It shares the host OS kernel but is **namespaced** (isolated filesystem, process tree, network stack, user IDs). The host machine can run Ubuntu 24 while the container appears to run Alpine Linux 3.19 — no VM overhead.

> **The crux:** Docker eliminated the "works on my machine" failure class by making the machine part of the artifact. When you ship a Docker image, you ship the machine.

---

## Chapter 1 — How Docker Images Are Actually Built

### The Layered Filesystem

A Docker image is not a monolithic file. It is a stack of **read-only layers**, where each Dockerfile instruction produces one layer.

```
┌─────────────────────────────────────────────┐
│  Layer 5: COPY . .  (your source code)       │  ← changes every commit
├─────────────────────────────────────────────┤
│  Layer 4: RUN npm run build  (build output)  │  ← changes every commit
├─────────────────────────────────────────────┤
│  Layer 3: RUN npm ci  (node_modules)         │  ← changes only when package.json changes
├─────────────────────────────────────────────┤
│  Layer 2: COPY package.json .  (manifest)    │  ← changes rarely
├─────────────────────────────────────────────┤
│  Layer 1: FROM node:20-alpine  (base image)  │  ← changes almost never
└─────────────────────────────────────────────┘
```

When you rebuild:
- Docker hashes each instruction + its input files
- If the hash matches a cached layer, **skip** (reuse from cache)
- If the hash is different, **rebuild this layer and every layer above it**

This is why Dockerfile instruction ordering matters enormously for CI build times.

### The Cache Invalidation Rule

```
❌ Wrong order — cache always misses on npm ci:

COPY . .                   ← copies EVERYTHING including src/
RUN npm ci                 ← ANY source file change invalidates this

✅ Right order — cache hits on npm ci unless package.json changes:

COPY package.json package-lock.json ./   ← only manifest files
RUN npm ci                               ← only reruns if manifests changed
COPY . .                                 ← source changes don't affect npm ci layer
```

**Production impact:** In a team committing 50 times a day, the wrong order means 50 full `npm ci` runs. The right order means 1 (or 0) per day.

### Multi-Stage Builds — Why They Exist

A single-stage build carries every tool that was used to build the artifact:

```
Single-stage image contents (1.2 GB):
├── Node.js 20 (runtime)
├── TypeScript compiler (build tool — not needed at runtime)
├── ESLint / Prettier (dev tool — never needed at runtime)
├── node_modules/ including devDependencies (~400 MB of test/build tools)
├── Source maps (.map files — useful for debugging, not for running)
├── Source code (TypeScript .ts files — compiled to JS already)
└── Build artifacts (.next/ — what you actually need)
```

Multi-stage separates **build environment** from **runtime environment**:

```dockerfile
# Stage 1: Install all dependencies (including dev)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false   # includes devDependencies

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
RUN npm run build

# Stage 3: Runtime — only what's needed to run
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Selectively copy artifacts, not the entire build context
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "server.js"]
```

The `runner` stage starts fresh from `node:20-alpine` and receives only what `--from=builder` explicitly copies. TypeScript compiler, ESLint, all devDependencies — they were never copied into this stage. They don't exist in the final image.

```
Multi-stage runtime image contents (180 MB):
├── Node.js 20 (runtime)
├── .next/standalone (compiled, standalone Next.js server)
├── .next/static (client assets)
├── public/ (static files)
└── node_modules/.prisma (compiled Prisma client only)
```

**Security benefit beyond size:** A smaller image has a smaller attack surface. A compromised container that can't find `npm`, `git`, or `bash` can do far less damage.

---

## Chapter 2 — ECR: AWS's Answer to "Where Do Images Live?"

### The Registry Problem

After `docker build`, you have an image on your developer laptop. The EKS cluster in `ap-south-1` needs to pull it. You need:

1. **Somewhere to store the image** — a registry
2. **Authentication** — only authorized entities can push or pull
3. **Network efficiency** — pulling a 1 GB image over the internet from Docker Hub on every pod startup is unacceptable

ECR (Elastic Container Registry) solves all three within the AWS ecosystem.

### How ECR Authentication Works (The Real Mechanism)

ECR does not have usernames and passwords. It uses AWS SigV4 authentication flowing through IAM.

```
Step 1: Your CI runner or EC2 instance has IAM credentials (role or access key)

Step 2: You run:
  aws ecr get-login-password --region ap-south-1

Step 3: This command:
  - Calls the ECR API endpoint using your IAM credentials (SigV4 signed)
  - ECR validates your IAM identity against your account's permissions
  - ECR returns a time-limited Docker registry password (valid 12 hours)

Step 4: You pipe that password to docker login:
  aws ecr get-login-password --region ap-south-1 \
    | docker login --username AWS --password-stdin \
      123456789.dkr.ecr.ap-south-1.amazonaws.com

Step 5: Docker stores the credential in ~/.docker/config.json
        Now push/pull works like normal Docker
```

> **The crux:** The password is ephemeral and derived from IAM. There is no long-lived Docker credential to rotate, store, or accidentally leak. When an EC2 instance or EKS node has an IAM role with `ecr:GetAuthorizationToken` + `ecr:BatchGetImage`, pulling images is automatic — no credential management.

### ECR Image Lifecycle Policies

You don't want thousands of old images accumulating. ECR lifecycle policies clean up automatically:

```json
{
  "rules": [{
    "rulePriority": 1,
    "description": "Keep last 20 images",
    "selection": {
      "tagStatus": "any",
      "countType": "imageCountMoreThan",
      "countNumber": 20
    },
    "action": { "type": "expire" }
  }]
}
```

In practice: tag your images with git SHA (`docker build -t repo:${GITHUB_SHA}`). Each CI run produces one tagged image. Lifecycle policy retains the last 20, auto-deletes the rest. No manual cleanup.

---

## Chapter 3 — Kubernetes Architecture From First Principles

### Why You Need an Orchestrator

You have 10 containers to run. Without an orchestrator, questions pile up:

```
Which server runs which container?        → Manual assignment, error-prone
What if a container crashes?              → Manual restart, potential downtime
What if an entire server (node) dies?     → Move containers manually? SLA broken
How do you update without downtime?       → Careful scripting, risky
How do you scale up under traffic?        → More manual intervention
How does traffic reach the right pod?     → DNS / load balancer management
How do containers share secrets safely?   → Files? Environment variables? SSH?
```

Kubernetes answers all of these declaratively. You state **what you want**; Kubernetes figures out **how to achieve and maintain it**.

### The Desired State Model — This Is The Philosophy

Kubernetes is built around one idea: **desired state reconciliation**.

```
You:        kubectl apply -f deployment.yml
            "I want 3 replicas of this app always running"

Kubernetes: Stores this in etcd as desired state.
            Controller: loops forever checking actual vs desired
            Scheduler: places pods on appropriate nodes
```

Something bad happens:

```
Pod on Node 2 crashes:
  Controller: desired=3, actual=2 → gap of 1
  Scheduler: "Node 1 has capacity" → schedule new pod there
  Time to recovery: ~10 seconds. Fully automatic.

Node 2 dies entirely (hardware failure, AZ outage):
  Controller: desired=3, actual=1 → gap of 2
  Scheduler: places 2 new pods on Node 1 and Node 3
  Traffic: Service already removed Node 2 from its endpoint list (health checks)
  Outcome: No alert, no page, no manual intervention. It just heals.
```

This is what "self-healing" means in Kubernetes. It is not magic. It is a tight reconciliation loop running every few seconds.

### Control Plane Components — The Brain

```
┌─── CONTROL PLANE ────────────────────────────────────────────────┐
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  kube-apiserver                                              │ │
│  │  Every kubectl command, every component interaction goes     │ │
│  │  through here. REST API over HTTPS. It is the only          │ │
│  │  component that reads/writes etcd.                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  etcd                                                        │ │
│  │  Distributed key-value store. The cluster's single source    │ │
│  │  of truth. Stores ALL cluster state: deployments, pods,      │ │
│  │  secrets, configs. If etcd is lost, the cluster is lost.     │ │
│  │  Production: always run as 3-node or 5-node cluster.         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  kube-scheduler                                              │ │
│  │  Watches for pods with no assigned node ("Pending" state).   │ │
│  │  Evaluates node capacity (CPU, memory), taints, affinities,  │ │
│  │  and assigns the pod to the best node.                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  kube-controller-manager                                     │ │
│  │  Runs multiple controllers in one binary:                    │ │
│  │  • ReplicaSet controller — maintains desired replica count   │ │
│  │  • Node controller — detects node failures                   │ │
│  │  • Endpoint controller — updates Service endpoint lists      │ │
│  │  • Job controller — manages one-off batch pods               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Worker Node Components

Each node (EC2 instance) runs:

```
┌─── WORKER NODE ─────────────────────────────────────────────────┐
│                                                                   │
│  kubelet                                                          │
│  ├── Node's primary agent, talks to kube-apiserver               │
│  ├── Receives pod specs (what containers to run)                  │
│  ├── Starts/stops containers via the container runtime            │
│  └── Reports node health and pod status back to control plane     │
│                                                                   │
│  kube-proxy                                                       │
│  ├── Implements Service networking on the node                    │
│  ├── Sets up iptables/ipvs rules to route traffic to pods         │
│  └── Keeps rules in sync as pods start/stop                       │
│                                                                   │
│  Container Runtime (containerd)                                   │
│  ├── Actually runs containers (pulls images, creates namespaces)  │
│  └── Implements Container Runtime Interface (CRI)                 │
│                                                                   │
│  Pods (one or more per node)                                      │
│  └── Each pod = one or more containers sharing:                   │
│      ├── Network namespace (same IP, same localhost)              │
│      ├── IPC namespace (can communicate via shared memory)        │
│      └── (optionally) volumes                                     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Chapter 4 — Kubernetes Objects Deep Dive

### Pod — The Atomic Unit

A Pod is the smallest deployable unit. It wraps one or more containers that must run together on the same node and share networking.

```
Why would you put two containers in one Pod?
→ Sidecar pattern: app container + logging agent (they share /var/log volume)
→ Init container: runs before main container to prep the environment
→ Ambassador pattern: app + proxy container sharing localhost networking

Why NOT put two containers in one Pod?
→ They scale together. If your API and your cache need different replica counts, use two Deployments.
→ One crash affects the entire Pod.
```

You almost never create Pods directly. You create Deployments (which manage ReplicaSets, which manage Pods).

### Deployment — The Desired State Declaration

```yaml
spec:
  replicas: 3                    # "Always keep exactly 3 pods running"
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0          # Never go below desired count during update
      maxSurge: 1                # Temporarily allow 1 extra pod during update
```

With `maxUnavailable: 0` and `maxSurge: 1`, a rolling update with 3 replicas proceeds:

```
State 0: [v1] [v1] [v1]              ← baseline (3 pods)
State 1: [v1] [v1] [v1] [v2-new]    ← surge 1, start new pod (+1)
State 2: [v1] [v1] [v2-ready]       ← v2 passes readiness, kill one v1 (0 down)
State 3: [v1] [v2-ready] [v2-new]   ← surge 1 again
State 4: [v2-ready] [v2-ready]      ← kill second v1
State 5: [v2] [v2] [v2]             ← complete, zero downtime
```

The readiness probe is what determines when a new pod is "ready" in the above flow. **If your readiness probe is wrong, rolling updates can silently break production.**

### Service — Stable Networking for Ephemeral Pods

Pods are ephemeral. They get new IPs on every restart. Services provide a stable virtual IP and DNS name that always routes to healthy pods.

```
Problem without Services:
  Pod A IP: 10.0.1.5   → pod dies → restarted at 10.0.2.12
  Pod B IP: 10.0.1.6   → scaled up → new pod at 10.0.3.8
  
  How does your frontend know where to call the backend?
  It can't hardcode pod IPs.
```

```yaml
kind: Service
spec:
  selector:
    app: signal-garden       # Routes to any pod with this label
  ports:
    - port: 80               # What the Service exposes
      targetPort: 3000       # What the pod is actually listening on
```

```
Service DNS: signal-garden-svc.production.svc.cluster.local
             → resolves to a virtual ClusterIP (e.g. 10.100.50.20)
             → kube-proxy routes traffic to a healthy pod's real IP
             → Pod comes and goes, Service DNS stays the same
```

**Service types:**

| Type | Scope | Use Case |
|------|-------|----------|
| `ClusterIP` | Internal cluster only | Backend-to-backend communication |
| `NodePort` | Exposes port on every node | Simple external access (dev/testing) |
| `LoadBalancer` | AWS provisions an ALB/NLB | Production external traffic entry |

### Ingress — HTTP Routing Layer

A `LoadBalancer` Service gives you one ALB per Service. With 20 microservices, that's 20 ALBs — expensive and unmanageable.

Ingress uses one ALB and routes based on HTTP path or hostname:

```yaml
kind: Ingress
spec:
  rules:
    - host: signal-garden.fun
      http:
        paths:
          - path: /api
            backend:
              service:
                name: api-svc
          - path: /
            backend:
              service:
                name: frontend-svc
    - host: admin.signal-garden.fun
      http:
        paths:
          - path: /
            backend:
              service:
                name: admin-svc
```

One ALB, multiple applications, path and host-based routing, TLS termination at the ingress — this is the production pattern.

### ConfigMap vs Secret — Configuration Management

```
ConfigMap: non-sensitive config
  Database host, feature flags, timeout values, API base URLs
  Stored as plaintext in etcd
  Safe to put in Git (no credentials)

Secret: sensitive config
  Database passwords, API keys, JWT secrets, TLS certs
  Stored base64-encoded in etcd (NOT encrypted by default in stock K8s)
  Should NOT be put in Git
```

**Important distinction:** Base64 is encoding, not encryption. Anyone who can read etcd can decode secrets. In EKS:
- Enable etcd encryption at rest (KMS key encrypts etcd data)
- Or use External Secrets Operator + AWS Secrets Manager (secrets live outside the cluster entirely)

```
Kubernetes Secret workflow without External Secrets Operator:
  Developer base64-encodes a password → creates Secret YAML → applies it
  Anyone with cluster access can: kubectl get secret signal-garden-secrets -o yaml
  → and decode the base64 → get the password

Kubernetes Secret workflow WITH External Secrets Operator + AWS Secrets Manager:
  Password lives in AWS Secrets Manager (encrypted, audited, rotatable)
  ExternalSecret object tells K8s: "fetch this from Secrets Manager"
  Operator fetches it and creates a native K8s Secret
  You never put the actual value in a YAML file or Git
```

### HPA — Horizontal Pod Autoscaler

```yaml
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    kind: Deployment
    name: signal-garden
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # Scale when average CPU > 70%
```

When average CPU across pods exceeds 70%, HPA adds replicas. When it drops below, HPA removes replicas (down to `minReplicas`). Scale-out is fast (new pods in ~30s); scale-in is deliberately slow (5-minute cooldown by default) to avoid thrashing.

---

## Chapter 5 — EKS: What AWS Manages vs What You Manage

### The Problem With Self-Managed Kubernetes

Running a production Kubernetes control plane is genuinely hard:

```
etcd:
  → Must run as 3-node or 5-node cluster for HA
  → Regular backups (losing etcd = losing the cluster)
  → Version upgrades must follow strict procedures
  
API server:
  → Must be highly available (multiple replicas behind a load balancer)
  → TLS certificates that must be rotated
  → Authentication webhook integrations
  
Version upgrades:
  → Must upgrade control plane first, then worker nodes
  → Cannot skip versions (1.24 → 1.25 → 1.26, not 1.24 → 1.26)
  → Deprecation breaking changes between versions
  → Each upgrade is a multi-hour planned maintenance window
```

EKS eliminates the control plane concern entirely:

```
AWS manages:
  ✅ kube-apiserver (multi-AZ, highly available)
  ✅ etcd (multi-AZ, backed up)
  ✅ kube-scheduler
  ✅ kube-controller-manager
  ✅ Control plane version upgrades (push-button)
  ✅ Control plane TLS certificate rotation
  ✅ Control plane security patches

You manage:
  → Worker nodes (EC2 instances in your VPC)
  → Node version updates (AMI updates, can use managed node groups)
  → Application deployments
  → Kubernetes add-ons (metrics-server, cluster-autoscaler, AWS LB Controller)
  → IAM roles for pods (IRSA — IAM Roles for Service Accounts)
```

### EKS Node Strategies

**Managed Node Groups** — the standard choice:
```
AWS provisions EC2 instances using an EKS-optimized AMI
You set: instance type, min/max nodes, desired count
AWS handles: EC2 lifecycle, AMI updates, graceful node draining during updates
You get: full EC2 control (instance type, storage, networking) + managed updates
```

**Fargate Profiles** — for serverless workloads:
```
No EC2 nodes to manage
AWS runs each pod on a dedicated microVM
You pay per pod (vCPU-seconds + memory-seconds)
Limitations: no DaemonSets, no GPUs, no persistent volumes (most types)
Best for: bursty workloads, event-driven jobs, reducing operational overhead
```

### IAM Roles for Service Accounts (IRSA) — How Pods Access AWS

A critical concept. Pods often need to access AWS services (S3, SQS, Secrets Manager). The naive approach — putting AWS credentials in a Kubernetes Secret — is a security anti-pattern.

IRSA allows a Kubernetes Service Account to assume an IAM role, giving pods AWS permissions without credentials:

```
1. Create IAM role with an OIDC trust relationship:
   "Allow EKS cluster's OIDC provider to assume this role
    IF the requesting Service Account is 'signal-garden-sa' in namespace 'production'"

2. Annotate the Kubernetes Service Account:
   kubectl annotate serviceaccount signal-garden-sa \
     eks.amazonaws.com/role-arn=arn:aws:iam::123456789:role/signal-garden-role

3. Pod spec references that Service Account:
   spec:
     serviceAccountName: signal-garden-sa

4. At runtime:
   → kubelet injects a projected volume with a short-lived OIDC token into the pod
   → AWS SDK calls STS AssumeRoleWithWebIdentity using that token
   → STS validates token against the EKS cluster's OIDC provider
   → Returns temporary AWS credentials valid for 1 hour (auto-refreshed)
```

The pod can now call S3, SQS, Secrets Manager — with no AWS credentials stored anywhere in the cluster.

---

## Chapter 6 — The Complete Deployment Flow

### Code Push → Production Pod

```
1. Developer pushes to main branch on GitHub

2. GitHub Actions trigger:
   ├── Checkout code
   ├── Configure AWS credentials (IAM access key or OIDC for GitHub Actions)
   ├── Login to ECR: aws ecr get-login-password | docker login ...
   ├── docker build -t $ECR_REPO:$GITHUB_SHA .
   │     └── Layers: base image (cached) → npm ci (cached if pkg unchanged)
   │              → prisma generate → npm run build → copy artifacts
   ├── docker push $ECR_REPO:$GITHUB_SHA
   │     └── Only changed layers are uploaded (layer deduplication)
   └── kubectl set image deployment/signal-garden signal-garden=$ECR_REPO:$GITHUB_SHA

3. Kubernetes processes the deployment update:
   ├── API server receives the patch, stores new desired state in etcd
   ├── Deployment controller detects desired≠actual, creates new ReplicaSet
   ├── Scheduler assigns new pod(s) to nodes with available capacity
   ├── kubelet on target node: pulls image from ECR (IAM auth via node role)
   ├── containerd starts the container
   ├── readinessProbe begins: GET /api/health every 5s
   ├── After 2 consecutive successes: pod marked Ready
   ├── Service's endpoint list updated: traffic now routes to new pod
   └── Old pod terminated (rolling update: one at a time, zero downtime)

4. kubectl rollout status deployment/signal-garden
   └── CI waits here. If pods crash and can't become Ready, this fails.
       CI pipeline fails → alerts engineer → old pods are still running
       (Kubernetes doesn't terminate old pods until new ones are Ready)
```

### The Health Check Chain — Why It Matters

```yaml
readinessProbe:    # "Is this pod ready to receive traffic?"
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10   # Wait 10s before first check (app startup time)
  periodSeconds: 5          # Check every 5 seconds
  failureThreshold: 3       # 3 consecutive failures → remove from Service endpoints

livenessProbe:     # "Is this pod still alive and not hung?"
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30   # Give app more time before liveness kicks in
  periodSeconds: 15
  failureThreshold: 3       # 3 consecutive failures → restart the container
```

The difference:
- **Readiness failure** → pod removed from load balancer, stays running
- **Liveness failure** → pod is KILLED and restarted

A pod can be live but not ready (e.g. still warming up a cache, DB migration running). During that window it should not receive traffic but should not be killed either.

A pod that is neither live nor ready after repeated liveness checks is stuck — kill and restart it.

> **Common mistake:** Using the same probe for both. Set `initialDelaySeconds` much higher for liveness — if liveness fires before the app is ready, it creates a restart loop.

---

## Chapter 7 — Security in Production

### Kubernetes RBAC — Who Can Do What

Kubernetes has its own RBAC system controlling what identities can do against the API server:

```yaml
# Role: read-only access to pods in "production" namespace
kind: Role
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  namespace: production
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]

---
# RoleBinding: bind the role to a user or service account
kind: RoleBinding
metadata:
  name: read-pods-binding
  namespace: production
subjects:
  - kind: User
    name: "developer@company.com"
roleRef:
  kind: Role
  name: pod-reader
```

In EKS, AWS IAM identities map to Kubernetes RBAC subjects via the `aws-auth` ConfigMap (or the newer Access Entry API). An IAM user or role gets mapped to a Kubernetes username, then RBAC takes over.

### Network Policies — Deny by Default

By default, all pods can talk to all other pods. In a microservices setup, that means a compromised frontend pod can directly query the database pod.

```yaml
# Allow signal-garden pods to only receive traffic from the ingress controller
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: signal-garden-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: signal-garden
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: ingress-nginx   # Only allow traffic from ingress pods
      ports:
        - port: 3000
```

Zero-trust network policy: default-deny all ingress, explicitly allow what's needed. This limits blast radius if a pod is compromised.

---

## Chapter 8 — Interview Cruxes

### "What's the difference between a Pod and a Deployment?"

> "A Pod is a single instance of running containers. A Deployment is a desired state declaration — 'run N replicas of this pod, always.' The Deployment controller continuously reconciles actual replica count with desired. If you run a naked Pod and it crashes, it's gone. Wrap it in a Deployment and Kubernetes restarts it automatically."

### "How does Kubernetes achieve zero-downtime deployments?"

> "Through rolling updates configured with `maxUnavailable: 0` and `maxSurge: 1`. The Deployment controller starts new pods, waits for their readiness probe to succeed, adds them to the Service's endpoint list, then terminates old pods. At no point are all pods on the new version simultaneously — there's always overlap. The readiness probe is the critical gating mechanism — if the new version's probe never passes, old pods are never terminated."

### "What does EKS actually manage for you?"

> "EKS manages the entire control plane: kube-apiserver, etcd, scheduler, controller-manager. All run in AWS-managed infrastructure, multi-AZ, with automated backups and patch management. You pay $0.10/hour for this. You still manage worker nodes (EC2), application deployments, add-ons, and IAM bindings. The value prop is: the parts that are hardest to run reliably (etcd HA, control plane upgrades) are someone else's problem."

### "How do pods securely access AWS services?"

> "IRSA — IAM Roles for Service Accounts. Each Service Account is annotated with an IAM Role ARN. EKS projects a short-lived OIDC token into the pod. The AWS SDK uses STS AssumeRoleWithWebIdentity with that token. STS validates it against the cluster's OIDC provider and returns temporary credentials. No static AWS credentials anywhere in the cluster."

### "Why are Kubernetes Secrets not actually secret?"

> "Base64 is encoding, not encryption. If you have `get` permission on Secrets in Kubernetes RBAC, you can retrieve and decode any secret. At-rest encryption in etcd requires explicit configuration. For real secret security: enable etcd encryption with a KMS key, or use External Secrets Operator with AWS Secrets Manager — secrets never live in the cluster state, only get fetched at pod creation."

---

## Chapter 9 — The Whole Picture

```
Developer's git push
       │
       ▼
GitHub Actions:
  Build Docker image (multi-stage, layer-cached)
       │
       ▼
ECR (private registry):
  Image stored as: 123456789.dkr.ecr.ap-south-1.amazonaws.com/signal-garden:abc123
       │
       ▼
kubectl set image (via OIDC GitHub Actions role → IAM → EKS API)
       │
       ▼
EKS Cluster (AWS manages control plane):
  ┌─── Deployment: signal-garden ──────────────────────────────┐
  │  Rolling update: maxUnavailable=0, maxSurge=1              │
  │  Readiness probe gates: no traffic until /api/health 200   │
  │  IRSA: pods assume IAM role, access Secrets Manager        │
  │                                                             │
  │  Pod 1 (Node A, ap-south-1a)  ←── Service ClusterIP ───┐  │
  │  Pod 2 (Node B, ap-south-1b)  ←──────────────────────  │  │
  └─────────────────────────────────────────────────────────│──┘
                                                             │
  Service (type: LoadBalancer):                             │
  → AWS provisions Application Load Balancer automatically  │
  → Routes to healthy pods                                   ◄
  → signal-garden.fun → ALB DNS → Service → Pods
       │
       ▼
  RDS PostgreSQL (not inside Kubernetes — external service)
  Connected via DATABASE_URL injected from Secrets Manager via IRSA
```

Every piece in this chain either heals itself automatically or has been architected to fail gracefully. This is what production-grade means.
