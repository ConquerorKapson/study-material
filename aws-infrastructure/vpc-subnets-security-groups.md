---
title: "AWS VPC, Subnets, and Security Groups — Your Private Cloud Network"
description: "Build a mental model of VPCs, public/private subnets, route tables, internet gateways, and security groups — the backbone of every AWS architecture."
order: 2
---

# AWS VPC, Subnets, and Security Groups — Your Private Cloud Network

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate · **Related:** VPC · Subnets · Security Groups · NACLs · IGW

---

## 01 — TLDR

- A **VPC** is your isolated private network in AWS — think of it as your own data center in the cloud with a defined IP range (CIDR block)
- **Subnets** divide your VPC into segments: public subnets face the internet, private subnets are hidden behind NAT
- An **Internet Gateway (IGW)** is the front door — attach it to your VPC and route traffic through it to enable internet access
- **Route Tables** are the GPS — they tell traffic where to go; a subnet is "public" only because its route table points `0.0.0.0/0` at the IGW
- **NAT Gateways** let private instances download updates without being publicly accessible (one-way internet access)
- **Security Groups** are stateful firewalls at the instance level — default deny inbound, allow all outbound
- **NACLs** are stateless firewalls at the subnet level — use them as a blunt second layer of defense
- The killer pattern: **Security Group chaining** — your RDS security group allows traffic only from your EC2 security group, not from IP ranges

**Elevator pitch:** Every AWS architecture starts with a VPC. If you can't design one correctly, nothing you build on top of it will be secure or scalable. This is the blueprint for everything.

---

## 02 — What Is a VPC?

A VPC (Virtual Private Cloud) is your **private, isolated network** within AWS. Nothing gets in or out unless you explicitly allow it.

### The Apartment Building Analogy

| Real World | VPC Equivalent |
|---|---|
| The apartment building | Your VPC |
| The building's address range (units 1-200) | CIDR block (e.g., 10.0.0.0/16) |
| Individual floors | Subnets |
| The lobby (visitors allowed) | Public subnet |
| Server room in the basement (staff only) | Private subnet |
| The front door with a doorman | Internet Gateway |
| The building's internal directory | Route table |
| Apartment door locks | Security Groups |
| Floor-level key card access | NACLs |

### CIDR Blocks Explained

CIDR (Classless Inter-Domain Routing) defines your IP address range:

```
10.0.0.0/16  means:
├── Fixed part:   10.0._______.________  (first 16 bits locked)
├── Flexible part: ___.___.___.________  (last 16 bits = your IPs)
└── Total IPs:    65,536 addresses
```

| CIDR | Fixed Bits | Available IPs | Use Case |
|---|---|---|---|
| /16 | 16 bits | 65,536 | Large VPC (most common) |
| /20 | 20 bits | 4,096 | Medium subnet |
| /24 | 24 bits | 256 | Standard subnet |
| /28 | 28 bits | 16 | Tiny subnet (minimum for AWS) |

**AWS reserves 5 IPs in every subnet:**
- `.0` — Network address
- `.1` — VPC router
- `.2` — DNS server
- `.3` — Reserved for future use
- `.255` — Broadcast (not used in AWS, but reserved)

So a `/24` subnet (256 IPs) actually gives you **251 usable IPs**.

### Choosing Your VPC CIDR

```
Recommended: 10.0.0.0/16 (65,536 IPs — plenty of room)
Alternative: 172.31.0.0/16 (AWS default VPC uses this)

Avoid overlapping CIDRs if you plan to peer VPCs or use VPN!
```

> **Tech Lead decision:** Always plan bigger than you think. Expanding a VPC CIDR later is possible (secondary CIDRs) but messy. Start with /16 unless you have a reason not to.

---

## 03 — Subnets — Public vs Private

Subnets divide your VPC into isolated segments, each in a specific Availability Zone (AZ).

### The Mental Model

```
┌─────────────────────── VPC: 10.0.0.0/16 ───────────────────────┐
│                                                                   │
│  ┌─── AZ: us-east-1a ───┐    ┌─── AZ: us-east-1b ───┐         │
│  │                        │    │                        │         │
│  │  ┌─ Public Subnet ──┐ │    │  ┌─ Public Subnet ──┐ │         │
│  │  │  10.0.1.0/24     │ │    │  │  10.0.3.0/24     │ │         │
│  │  │  [EC2] [ALB]     │ │    │  │  [EC2] [ALB]     │ │         │
│  │  └──────────────────┘ │    │  └──────────────────┘ │         │
│  │                        │    │                        │         │
│  │  ┌─ Private Subnet ─┐ │    │  ┌─ Private Subnet ─┐ │         │
│  │  │  10.0.2.0/24     │ │    │  │  10.0.4.0/24     │ │         │
│  │  │  [RDS] [Lambda]  │ │    │  │  [RDS] [Lambda]  │ │         │
│  │  └──────────────────┘ │    │  └──────────────────┘ │         │
│  │                        │    │                        │         │
│  └────────────────────────┘    └────────────────────────┘         │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### What Makes a Subnet "Public" vs "Private"?

**A subnet is public if** its route table has a route sending `0.0.0.0/0` to an Internet Gateway. That's it. There's no "public" checkbox — it's purely about routing.

**A subnet is private if** it has no route to an IGW. Instances in it cannot be reached from the internet (and can't reach the internet without a NAT Gateway).

### What Goes Where?

| Resource | Subnet Type | Why |
|---|---|---|
| Application Load Balancer (ALB) | Public | Needs to accept traffic from the internet |
| EC2 web servers | Public (or private behind ALB) | Depends on architecture |
| API backend instances | Private | Only ALB should talk to them |
| RDS databases | Private | NEVER expose databases to the internet |
| ElastiCache (Redis) | Private | Internal caching only |
| Lambda (in VPC) | Private | Accesses private resources |
| NAT Gateway | Public | Needs internet access to relay for private instances |

### Multi-AZ for High Availability

**Always deploy across at least 2 AZs.** Each AZ is a physically separate data center:

```
If us-east-1a goes down:
├── Your public subnet in 1a: ❌ DOWN
├── Your private subnet in 1a: ❌ DOWN
├── Your public subnet in 1b: ✅ STILL RUNNING
├── Your private subnet in 1b: ✅ STILL RUNNING
└── ALB automatically routes to healthy targets in 1b
```

> **Interview Callout:** "Why do you need subnets in multiple AZs?" — "Each AZ is an isolated failure domain. If I only deploy in one AZ and that data center has a power outage, my entire application goes down. Multi-AZ gives me automatic failover."

---

## 04 — Internet Gateway (IGW)

The Internet Gateway is the **front door** of your VPC. Without it, nothing in your VPC can reach the internet, and the internet can't reach your VPC.

### Key Facts

- Only **one IGW per VPC**
- It's **horizontally scaled and highly available** — AWS manages it
- It's **free** (no hourly charge, just data transfer costs)
- It performs **NAT for instances with public IPs** (maps public ↔ private)

### How It Enables Public Access

```
Internet ←→ IGW ←→ Route Table ←→ Public Subnet ←→ EC2 Instance
                                                     (with public IP)
```

An EC2 instance is publicly accessible **only when ALL of these are true:**
1. ✅ VPC has an IGW attached
2. ✅ Subnet's route table points `0.0.0.0/0` → IGW
3. ✅ Instance has a public IP (or Elastic IP)
4. ✅ Security Group allows inbound traffic on the relevant port
5. ✅ NACL allows inbound traffic (default allows all)

Miss any one of these → no internet access.

---

## 05 — Route Tables

Route tables are the **GPS system** of your VPC. Every subnet has exactly one route table (but one route table can be shared by multiple subnets).

### Default Route Table (Every VPC Gets One)

| Destination | Target | Meaning |
|---|---|---|
| 10.0.0.0/16 | local | "Traffic within the VPC stays within the VPC" |

This `local` route is **immutable** — you can't delete it. It ensures all subnets in your VPC can talk to each other by default.

### Public Subnet Route Table

| Destination | Target | Meaning |
|---|---|---|
| 10.0.0.0/16 | local | Internal VPC traffic |
| 0.0.0.0/0 | igw-abc123 | "Everything else → Internet Gateway" |

### Private Subnet Route Table

| Destination | Target | Meaning |
|---|---|---|
| 10.0.0.0/16 | local | Internal VPC traffic |
| 0.0.0.0/0 | nat-xyz789 | "Everything else → NAT Gateway" |

### Route Evaluation

Routes are evaluated using **longest prefix match** — the most specific route wins:

```
Packet destination: 10.0.2.50

Available routes:
├── 10.0.0.0/16 → local       (matches: /16 = 16 bits)
├── 0.0.0.0/0   → igw-abc123  (matches: /0 = 0 bits)
└── Winner: 10.0.0.0/16 → local (most specific match)
```

---

## 06 — NAT Gateway

A NAT (Network Address Translation) Gateway lets instances in **private subnets** access the internet (for package updates, API calls) **without being reachable from the internet**.

### How It Works

```
┌── Private Subnet ──┐         ┌── Public Subnet ──┐
│                     │         │                     │
│  EC2 (10.0.2.50)   │────────▶│  NAT GW            │────────▶ Internet
│  "I need to run    │         │  (translates        │
│   apt-get update"  │         │   private→public)   │
│                     │         │                     │
│  ❌ Internet can't  │         │                     │
│     reach this EC2 │         │                     │
└─────────────────────┘         └─────────────────────┘
```

**Key behavior:**
- Outbound: ✅ Private instance → NAT → Internet (works)
- Inbound: ❌ Internet → NAT → Private instance (blocked)

### NAT Gateway Costs

| Component | Cost (us-east-1) | Notes |
|---|---|---|
| Hourly charge | ~$0.045/hour | ~$32/month per NAT GW |
| Data processing | ~$0.045/GB | Both directions |
| Multi-AZ (2 NAT GWs) | ~$64/month | For high availability |

> **Tech Lead decision:** NAT Gateways are expensive for high-traffic workloads. Alternatives:
> - **VPC Endpoints** — free for S3 and DynamoDB (Gateway endpoints)
> - **NAT Instance** — cheaper but you manage it (less available)
> - **PrivateLink** — for accessing AWS services without internet

### NAT Gateway Best Practices

- Deploy **one NAT Gateway per AZ** for high availability
- Place it in the **public subnet** (it needs internet access)
- Update private subnet route tables to point `0.0.0.0/0` → NAT Gateway
- Monitor with CloudWatch: `BytesOutToDestination`, `ConnectionEstablishedCount`

---

## 07 — Security Groups

Security Groups are **stateful firewalls** attached to individual resources (EC2, RDS, ALB, etc.). They are the **most important security control** in AWS.

### Key Properties

| Property | Security Group |
|---|---|
| Level | Instance/resource level |
| Stateful? | ✅ Yes — if inbound is allowed, response is auto-allowed |
| Default inbound | ❌ DENY ALL |
| Default outbound | ✅ ALLOW ALL |
| Rule type | ALLOW only (no explicit DENY rules) |
| Evaluation | All rules evaluated together (order doesn't matter) |
| Changes take effect | Immediately |

### "Stateful" — What Does It Mean?

```
Inbound rule: Allow TCP 443 from 0.0.0.0/0

What happens:
1. Client sends request to port 443        → ✅ Allowed (matches inbound rule)
2. Server sends response back to client    → ✅ Auto-allowed (stateful!)

You DON'T need a separate outbound rule for the response.
```

### Example Security Group: Web Server

```
Name: web-server-sg

Inbound Rules:
┌──────────┬──────────┬─────────────────┬──────────────────────┐
│ Type     │ Port     │ Source          │ Description          │
├──────────┼──────────┼─────────────────┼──────────────────────┤
│ HTTP     │ 80       │ 0.0.0.0/0      │ Public web traffic   │
│ HTTPS    │ 443      │ 0.0.0.0/0      │ Public web traffic   │
│ SSH      │ 22       │ 203.0.113.0/24 │ Office IP only       │
└──────────┴──────────┴─────────────────┴──────────────────────┘

Outbound Rules:
┌──────────┬──────────┬─────────────────┬──────────────────────┐
│ Type     │ Port     │ Destination     │ Description          │
├──────────┼──────────┼─────────────────┼──────────────────────┤
│ All      │ All      │ 0.0.0.0/0      │ Allow all outbound   │
└──────────┴──────────┴─────────────────┴──────────────────────┘
```

### Example Security Group: Database

```
Name: database-sg

Inbound Rules:
┌──────────┬──────────┬─────────────────┬──────────────────────┐
│ Type     │ Port     │ Source          │ Description          │
├──────────┼──────────┼─────────────────┼──────────────────────┤
│ MySQL    │ 3306     │ sg-web-server   │ Only from web tier   │
└──────────┴──────────┴─────────────────┴──────────────────────┘

Outbound Rules:
┌──────────┬──────────┬─────────────────┬──────────────────────┐
│ Type     │ Port     │ Destination     │ Description          │
├──────────┼──────────┼─────────────────┼──────────────────────┤
│ All      │ All      │ 0.0.0.0/0      │ Allow all outbound   │
└──────────┴──────────┴─────────────────┴──────────────────────┘
```

Notice the database SG **references another security group** as its source — not an IP address. This is Security Group Chaining.

---

## 08 — NACLs (Network Access Control Lists)

NACLs are **stateless firewalls** at the **subnet level**. They're the second layer of defense after Security Groups.

### Key Properties

| Property | NACL |
|---|---|
| Level | Subnet level |
| Stateful? | ❌ No — must explicitly allow inbound AND outbound |
| Default | ALLOW ALL (both directions) |
| Rule type | Both ALLOW and DENY |
| Evaluation | Rules processed in order (lowest number first) |
| Changes take effect | Immediately |

### Security Groups vs NACLs

| Feature | Security Group | NACL |
|---|---|---|
| Operates at | Instance level | Subnet level |
| Stateful | ✅ Yes | ❌ No |
| Rule types | Allow only | Allow + Deny |
| Rule evaluation | All at once | Numbered order |
| Default | Deny all inbound | Allow all |
| Applied to | Assigned to instances | Automatically to all instances in subnet |
| Use case | Primary firewall | Secondary defense, block specific IPs |

### NACL Rule Numbering

```
Rule #100: ALLOW TCP 443 from 0.0.0.0/0
Rule #200: ALLOW TCP 80 from 0.0.0.0/0
Rule #300: DENY TCP 22 from 198.51.100.0/24  (block known bad IP range)
Rule *:    DENY ALL (implicit final rule)
```

Rules are evaluated **top to bottom** (lowest number first). First match wins.

> **Best practice:** Number rules by 100s (100, 200, 300) so you can insert rules later (150) without renumbering everything.

### When to Use NACLs

| Scenario | Use NACL? | Why |
|---|---|---|
| Block a specific IP range | ✅ | Only NACLs can DENY traffic |
| Restrict port access to instances | ❌ | Use Security Groups instead |
| Compliance requirement for subnet-level filtering | ✅ | Defense in depth |
| Daily firewall management | ❌ | Too complex for routine use |

> **Interview Callout:** "Explain the difference between Security Groups and NACLs." — "Security Groups are stateful and operate at the instance level — I only need to allow inbound and the return traffic is automatically permitted. NACLs are stateless and operate at the subnet level — I must explicitly allow both inbound AND outbound traffic. Security Groups only have ALLOW rules; NACLs have both ALLOW and DENY. In practice, I use Security Groups as my primary firewall and NACLs only when I need to explicitly block specific IPs or meet compliance requirements."

---

## 09 — Security Group Chaining

This is the **single most important networking pattern in AWS**. It's how professionals design secure architectures.

### The Pattern

Instead of allowing traffic from **IP addresses**, you allow traffic from **another Security Group**:

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  ALB            │         │  EC2 Instances  │         │  RDS Database   │
│                 │         │                 │         │                 │
│  SG: alb-sg    │────────▶│  SG: app-sg     │────────▶│  SG: db-sg      │
│                 │         │                 │         │                 │
│  Inbound:      │         │  Inbound:       │         │  Inbound:       │
│  443 from      │         │  8080 from      │         │  5432 from      │
│  0.0.0.0/0     │         │  alb-sg ✅      │         │  app-sg ✅      │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

### Why This Is Superior to IP-Based Rules

| Approach | IP-Based Rules | SG Chaining |
|---|---|---|
| EC2 auto-scales (new IPs) | ❌ Must update rules manually | ✅ Automatic — new instances get the SG |
| IPs change (dynamic) | ❌ Rules become stale | ✅ SG reference is always current |
| Maintenance | ❌ Track every IP | ✅ Zero maintenance |
| Readability | ❌ "Who is 10.0.1.47?" | ✅ "Traffic from the app tier" |
| Security | ⚠️ IP spoofing possible | ✅ AWS enforces SG membership |

### Complete 3-Tier Example

```yaml
# ALB Security Group
alb-sg:
  inbound:
    - port: 443, source: 0.0.0.0/0    # Internet → ALB

# Application Security Group
app-sg:
  inbound:
    - port: 8080, source: alb-sg       # ALB → App (ONLY from ALB)
    - port: 22, source: bastion-sg     # SSH only from bastion

# Database Security Group
db-sg:
  inbound:
    - port: 5432, source: app-sg       # App → DB (ONLY from app tier)

# Bastion Security Group
bastion-sg:
  inbound:
    - port: 22, source: 203.0.113.0/24 # SSH only from office IP
```

**The chain:** Internet → ALB → App → DB. Each layer only accepts traffic from the layer immediately above it. A compromised ALB can't directly access the database.

---

## 10 — Complete Architecture: 3-Tier Web Application

### ASCII Architecture Diagram

```
                         ┌─────────────────────────────────────────────────────┐
                         │                    INTERNET                          │
                         └──────────────────────┬──────────────────────────────┘
                                                │
                         ┌──────────────────────▼──────────────────────────────┐
                         │              Internet Gateway (IGW)                   │
                         └──────────────────────┬──────────────────────────────┘
                                                │
┌───────────────────────────────────────────────┼───────────────────────────────────────┐
│                              VPC: 10.0.0.0/16 │                                        │
│                                               │                                        │
│  ┌─── AZ: us-east-1a ────────────────┐       │    ┌─── AZ: us-east-1b ───────────┐   │
│  │                                    │       │    │                                │   │
│  │  ┌─ Public Subnet: 10.0.1.0/24 ─┐│       │    │  ┌─ Public Subnet: 10.0.3.0/24│   │
│  │  │                               ││       │    │  │                             │   │
│  │  │  [ALB Node]  [NAT GW]         ││◀──────┼───▶│  │  [ALB Node]  [NAT GW]      │   │
│  │  │                               ││       │    │  │                             │   │
│  │  └───────────────────────────────┘│       │    │  └─────────────────────────────│   │
│  │                    │               │       │    │                    │            │   │
│  │                    ▼               │       │    │                    ▼            │   │
│  │  ┌─ Private Subnet: 10.0.2.0/24 ┐│       │    │  ┌─ Private Subnet: 10.0.4.0/24│   │
│  │  │                               ││       │    │  │                             │   │
│  │  │  [EC2: App Server]            ││       │    │  │  [EC2: App Server]          │   │
│  │  │  [EC2: App Server]            ││       │    │  │  [EC2: App Server]          │   │
│  │  │                               ││       │    │  │                             │   │
│  │  └───────────────────────────────┘│       │    │  └─────────────────────────────│   │
│  │                    │               │       │    │                    │            │   │
│  │                    ▼               │       │    │                    ▼            │   │
│  │  ┌─ Private Subnet: 10.0.5.0/24 ┐│       │    │  ┌─ Private Subnet: 10.0.6.0/24│   │
│  │  │                               ││       │    │  │                             │   │
│  │  │  [RDS Primary]                ││◀──────┼───▶│  │  [RDS Standby]             │   │
│  │  │                               ││  sync │    │  │                             │   │
│  │  └───────────────────────────────┘│       │    │  └─────────────────────────────│   │
│  │                                    │       │    │                                │   │
│  └────────────────────────────────────┘       │    └────────────────────────────────┘   │
│                                               │                                        │
└───────────────────────────────────────────────┴────────────────────────────────────────┘
```

### Route Tables for This Architecture

**Public Subnet Route Table:**

| Destination | Target |
|---|---|
| 10.0.0.0/16 | local |
| 0.0.0.0/0 | igw-abc123 |

**Private App Subnet Route Table:**

| Destination | Target |
|---|---|
| 10.0.0.0/16 | local |
| 0.0.0.0/0 | nat-xyz789 |

**Private DB Subnet Route Table:**

| Destination | Target |
|---|---|
| 10.0.0.0/16 | local |
| (no internet route) | — |

### Security Group Rules

```
alb-sg:         Inbound 443 from 0.0.0.0/0
app-sg:         Inbound 8080 from alb-sg; Inbound 22 from bastion-sg
db-sg:          Inbound 5432 from app-sg
bastion-sg:     Inbound 22 from office-cidr
```

---

## 11 — "What Would Go Wrong If..." Scenarios

### Scenario 1: RDS in a Public Subnet

**What happens:** Your database is directly reachable from the internet. Anyone with the endpoint URL can attempt connections.

**Impact:** 🔴 CRITICAL — Brute force attacks, SQL injection from the open internet, data breach risk.

**The fix:** Always place RDS in a private subnet. Access it only through your application tier (SG chaining) or via SSH tunneling through a bastion host.

### Scenario 2: Security Group with 0.0.0.0/0 on Port 3306

```
db-sg:
  inbound:
    - port: 3306, source: 0.0.0.0/0    ← 🔴 DISASTER
```

**What happens:** Your MySQL database is accessible from ANY IP address on the internet.

**Impact:** Automated scanners find open databases within minutes. Ransomware bots encrypt your data and demand Bitcoin. This is the #1 cause of AWS data breaches.

**The fix:** Source should be `app-sg` (Security Group chaining), never `0.0.0.0/0` for database ports.

### Scenario 3: No NAT Gateway for Private Instances

**What happens:** EC2 instances in private subnets can't reach the internet at all.

**Symptoms:**
- `apt-get update` hangs forever
- Can't download packages or security patches
- Can't reach external APIs (Stripe, SendGrid, etc.)
- CloudWatch agent can't push metrics

**The fix:** Add a NAT Gateway in the public subnet and update the private subnet's route table to point `0.0.0.0/0` → NAT Gateway. Or use VPC Endpoints for AWS services.

### Scenario 4: Misconfigured Route Table

```
Private subnet route table:
  0.0.0.0/0 → igw-abc123    ← This makes it PUBLIC!
```

**What happens:** You think you have a "private" subnet but instances with public IPs are directly reachable from the internet. The "private" classification is meaningless — routing determines access.

**The fix:** Private subnet route tables should point `0.0.0.0/0` → NAT Gateway (or have no default route at all).

---

## 12 — Common Mistakes Table

| Mistake | Consequence | Fix |
|---|---|---|
| Single-AZ deployment | One AZ failure = total outage | Deploy across 2+ AZs |
| RDS in public subnet | Database exposed to internet | Private subnet + SG chaining |
| SSH open to 0.0.0.0/0 | Brute force attacks | Restrict to office IP or use SSM |
| One SG for everything | Overly permissive, no isolation | Separate SG per tier/function |
| Hardcoded IPs in SG rules | Break when instances scale | Use SG references instead |
| No NAT Gateway | Private instances can't update | Add NAT GW or VPC Endpoints |
| /28 subnets (16 IPs) | Run out of IPs quickly | Use /24 (256 IPs) minimum |
| Overlapping VPC CIDRs | Can't peer VPCs later | Plan CIDR ranges upfront |
| Default VPC for production | Shared, not isolated | Create a dedicated VPC |
| Forgetting NACL is stateless | Return traffic blocked | Allow ephemeral ports (1024-65535) outbound |

---

## 13 — Tech Lead Decisions

### Multi-AZ vs Single-AZ: Cost vs Reliability

| Factor | Single-AZ | Multi-AZ |
|---|---|---|
| Cost | 🟢 Lower (one NAT GW, one set of instances) | 🔴 ~2x (duplicate everything) |
| Availability | 🔴 ~99.9% (one AZ failure = outage) | 🟢 ~99.99% (survives AZ failure) |
| Data transfer | 🟢 Free within same AZ | 🟡 $0.01/GB cross-AZ |
| RDS | 🔴 Manual failover | 🟢 Automatic failover (<60s) |
| Best for | Dev/staging, cost-sensitive | Production, customer-facing |

**The answer is almost always Multi-AZ for production.** The cost difference is small compared to the cost of downtime.

### VPC Peering vs Transit Gateway

| | VPC Peering | Transit Gateway |
|---|---|---|
| # of VPCs | 2-3 | 4+ |
| Cost | Free (data transfer only) | ~$0.05/hour + data |
| Complexity | Low (point-to-point) | Medium (hub-and-spoke) |
| Transitive routing | ❌ No | ✅ Yes |
| Cross-region | ✅ Yes | ✅ Yes |

### VPC Endpoints vs NAT Gateway

| | NAT Gateway | VPC Endpoints |
|---|---|---|
| Cost | $0.045/hour + $0.045/GB | Free (Gateway) or $0.01/hour (Interface) |
| For AWS services | ❌ Overkill | ✅ Purpose-built |
| For internet access | ✅ Required | ❌ AWS services only |
| S3/DynamoDB | Use Gateway Endpoint (free) | ✅ |
| Other AWS services | — | Use Interface Endpoint |

> **Tech Lead rule of thumb:** If you're accessing S3 from private subnets, always add a Gateway Endpoint (free). NAT Gateway charges $0.045/GB — for large data pipelines, that adds up fast.

---

## 14 — Design Exercise: VPC for a Startup

**Requirements:** Web application with React frontend, Node.js API, PostgreSQL database. Must survive AZ failure. Budget-conscious.

**Solution:**

```yaml
VPC: 10.0.0.0/16

Subnets:
  public-1a:  10.0.1.0/24   # ALB, NAT GW
  public-1b:  10.0.3.0/24   # ALB, NAT GW
  private-1a: 10.0.2.0/24   # EC2 (app servers)
  private-1b: 10.0.4.0/24   # EC2 (app servers)
  data-1a:    10.0.10.0/24  # RDS primary
  data-1b:    10.0.11.0/24  # RDS standby

Security Groups:
  alb-sg:     443 from 0.0.0.0/0
  app-sg:     3000 from alb-sg; 22 from bastion-sg
  db-sg:      5432 from app-sg
  bastion-sg: 22 from office-cidr

Cost optimization:
  - Single NAT GW (accept brief outage during AZ failure for updates)
  - S3 Gateway Endpoint (free, avoid NAT for S3 access)
  - t3.medium for app servers (burstable, cost-effective)
  - db.t3.medium for RDS (scale up later)
```

---

## 15 — Key Takeaways

| Concept | One-Liner |
|---|---|
| VPC | Your isolated private network — define it with a CIDR block |
| Public Subnet | Route table points 0.0.0.0/0 at an IGW |
| Private Subnet | No IGW route — use NAT for outbound internet |
| IGW | The front door — one per VPC, free, AWS-managed |
| Route Table | The GPS — determines where traffic goes |
| NAT Gateway | One-way internet for private instances — costs money |
| Security Group | Stateful instance firewall — your primary defense |
| NACL | Stateless subnet firewall — secondary, for explicit denies |
| SG Chaining | Reference SGs in rules, not IPs — the pro pattern |

> **Final thought:** If you understand VPC architecture deeply enough to draw it on a whiteboard and explain every security group rule, you're ready for any AWS architecture discussion in an interview. This is the foundation that everything — ECS, Lambda, EKS, RDS — sits on top of.

---

*Next up: [SSH — Secure Server Access](./ssh-server-access.md) — where we learn how to actually connect to the instances we just designed.*
