---
title: "Phase 2 — VPC, Subnets, and Security Groups"
description: "AWS networking architecture — VPCs, public/private subnets, security groups, NACLs. The backbone of cloud security."
order: 2
---

# Phase 2 — VPC, Subnets, and Security Groups

> **Category:** Infrastructure · **Difficulty:** Intermediate · **Related:** Networking · EC2 · RDS

---

## TLDR

A VPC is your private data center in AWS. Inside it, you create **public subnets** (internet-accessible, for EC2) and **private subnets** (hidden, for RDS). Security Groups are instance-level firewalls that say "only allow traffic from X on port Y." The single most critical security rule: RDS Security Group only allows connections from your EC2's Security Group.

---

## 01 — The Real-World Analogy

Think of your VPC as a gated corporate campus:

| AWS Concept | Campus Analogy |
|------------|----------------|
| VPC | The entire campus (fenced, private) |
| CIDR block | The address range for buildings (10.0.0.0/16) |
| Public Subnet | Buildings with street-facing entrances (reception) |
| Private Subnet | Internal buildings (no street access, staff only) |
| Internet Gateway | The main gate to the public road |
| Route Table | Signs directing people: "Exit? → Main gate" |
| Security Group | Badge readers on each room: "Only these people" |
| NACL | Security checkpoints at building entrances |
| NAT Gateway | Mail room — internal staff can SEND mail out, but outsiders can't walk in |

---

## 02 — VPC: Your Private Cloud Network

### What Is a VPC?

A [VPC](/aws-infrastructure/00-glossary#vpc) is a logically isolated network you create in AWS. Think of it as carving out your own chunk of AWS's data centers that only you can access.

### CIDR Block — Your Address Space

When you create a VPC, you choose a [CIDR](/aws-infrastructure/00-glossary#cidr) block — the range of private IPs available inside:

```
VPC CIDR: 10.0.0.0/16
Available IPs: 10.0.0.0 → 10.0.255.255 (65,536 addresses)
```

**Common mistake:** Choosing too small a CIDR. You can't easily expand later. Start with `/16` for production VPCs.

### Default VPC vs Custom VPC

| | Default VPC | Custom VPC |
|--|-------------|------------|
| Created automatically | ✅ One per region | ❌ You create it |
| Subnets | All public | You design |
| Good for | Quick experimentation | Production workloads |
| Security posture | Permissive | You control everything |

> **Real-world rule:** Never run production in the default VPC. Create a custom VPC with intentional subnet design.

---

## 03 — Subnets: Carving Up Your Network

### Public vs Private Subnets

```
VPC (10.0.0.0/16)
├── Public Subnet (10.0.1.0/24) ← EC2 lives here
│   └── Route: 0.0.0.0/0 → Internet Gateway ← THIS makes it public
│
├── Private Subnet (10.0.2.0/24) ← RDS lives here
│   └── Route: NO route to internet ← THIS makes it private
│
└── Private Subnet (10.0.3.0/24) ← RDS (2nd AZ, required)
    └── Route: NO route to internet
```

**The key difference is NOT the subnet itself** — it's the route table. A subnet is "public" only because its route table has a path to an [IGW](/aws-infrastructure/00-glossary#igw).

### Multi-AZ Design (Production Standard)

```
Region: ap-south-1
├── AZ: ap-south-1a
│   ├── Public Subnet  (10.0.1.0/24) → EC2 #1
│   └── Private Subnet (10.0.2.0/24) → RDS Primary
│
└── AZ: ap-south-1b
    ├── Public Subnet  (10.0.3.0/24) → EC2 #2 (future)
    └── Private Subnet (10.0.4.0/24) → RDS Standby
```

RDS requires subnets in at least 2 AZs (even free tier). This enables failover if one data center goes down.

---

## 04 — Internet Gateway & Route Tables

### Internet Gateway (IGW)

The "front door" connecting your VPC to the internet. Without it, nothing inside can communicate with the outside world.

```
Public Subnet Route Table:
┌──────────────────┬──────────────────┐
│ Destination      │ Target           │
├──────────────────┼──────────────────┤
│ 10.0.0.0/16      │ local            │  ← Traffic within VPC stays internal
│ 0.0.0.0/0        │ igw-abc123       │  ← Everything else → internet
└──────────────────┴──────────────────┘

Private Subnet Route Table:
┌──────────────────┬──────────────────┐
│ Destination      │ Target           │
├──────────────────┼──────────────────┤
│ 10.0.0.0/16      │ local            │  ← ONLY internal traffic
└──────────────────┴──────────────────┘
                    ↑ No 0.0.0.0/0 route = NO internet access
```

### NAT Gateway (When Private Needs Internet)

Private instances sometimes need outbound internet (package updates, API calls). A [NAT Gateway](/aws-infrastructure/00-glossary#nat-gateway) enables this:

```
Private EC2 → NAT Gateway (in public subnet) → IGW → Internet
                     ↑
         Outbound: ✅ allowed
         Inbound:  ❌ blocked (no one can initiate TO private instance)
```

**Cost warning:** NAT Gateways cost ~$32/month + data charges. For dev/free-tier, skip it (run everything in public subnet or use VPC endpoints).

---

## 05 — Security Groups: Instance-Level Firewall

### The Mental Model

A [Security Group](/aws-infrastructure/00-glossary#security-group) is a whitelist of allowed traffic. **Default = deny everything. You explicitly ALLOW what's needed.**

### Critical Property: Stateful

If you allow an INBOUND request on port 443, the response is **automatically allowed out**. You don't need separate outbound rules for responses.

```
Inbound rule: Allow TCP 443 from 0.0.0.0/0
→ Request comes in on 443 ✅
→ Response goes back automatically ✅ (stateful)
```

### EC2 Security Group (Web Server)

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 22 | YOUR IP only (e.g., 203.0.113.5/32) | SSH access |
| Inbound | TCP | 80 | 0.0.0.0/0 | HTTP (redirect to HTTPS) |
| Inbound | TCP | 443 | 0.0.0.0/0 | HTTPS traffic |
| Outbound | All | All | 0.0.0.0/0 | Allow all outbound (default) |

### RDS Security Group (Database)

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 5432 | **sg-ec2-web** (EC2's SG ID) | Only EC2 can connect |

> **THIS IS THE MOST IMPORTANT SECURITY DECISION.** RDS allows connections ONLY from the EC2 security group — not from any IP, not from anywhere else. Even if someone compromises another machine in your VPC, they can't reach RDS unless they're in that specific SG.

### Security Group Chaining (Key Pattern)

```
Internet → [SG: allow 443] → EC2 → [SG: allow 5432 from EC2-SG] → RDS
                                         ↑
                               Source = Security Group ID, not an IP!
```

This is called "SG referencing" — the RDS SG trusts the EC2 SG, not a specific IP. If you replace the EC2 instance, it still works as long as the new instance uses the same SG.

---

## 06 — NACLs: Subnet-Level Firewall

### Security Groups vs NACLs

| | Security Groups | NACLs |
|--|----------------|-------|
| **Level** | Instance | Subnet |
| **Stateful?** | ✅ Yes (responses auto-allowed) | ❌ No (must allow both directions) |
| **Default** | Deny all inbound, allow all outbound | Allow all (default NACL) |
| **Rules** | Allow only | Allow AND Deny |
| **Evaluation** | All rules evaluated together | Rules evaluated in order (number) |
| **Use case** | Primary defense | Second layer / compliance |

### When NACLs Matter

For most setups, Security Groups are sufficient. Use NACLs when:
- You need to explicitly **DENY** specific IPs (SGs can only allow)
- Compliance requires defense-in-depth (two independent layers)
- You want subnet-wide rules (e.g., block a known malicious IP range)

---

## 07 — Putting It Together: Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VPC (10.0.0.0/16)                      │
│                                                          │
│  ┌──────── AZ-a ────────┐  ┌──────── AZ-b ────────┐    │
│  │                       │  │                       │    │
│  │  Public (10.0.1.0/24) │  │  Public (10.0.3.0/24) │    │
│  │  ┌─────────────┐     │  │                       │    │
│  │  │    EC2      │     │  │  (future EC2 #2)      │    │
│  │  │  SG: web    │     │  │                       │    │
│  │  └─────────────┘     │  │                       │    │
│  │         │             │  │                       │    │
│  │  Private (10.0.2.0/24)│  │  Private (10.0.4.0/24)│    │
│  │  ┌─────────────┐     │  │  ┌─────────────┐     │    │
│  │  │    RDS      │     │  │  │  RDS Standby │     │    │
│  │  │  SG: db     │     │  │  │  SG: db      │     │    │
│  │  └─────────────┘     │  │  └─────────────┘     │    │
│  └───────────────────────┘  └───────────────────────┘    │
│                                                          │
│  IGW ←→ Public subnets only                              │
└─────────────────────────────────────────────────────────┘
```

---

## 🧠 Quick Recall

1. What makes a subnet "public" vs "private"?
2. Why does RDS need subnets in 2 AZs?
3. What does "stateful" mean for Security Groups?
4. How does SG chaining work? (EC2 SG → RDS SG)
5. When would you use a NACL over a Security Group?
6. What's the default behavior of a new Security Group?

---

## 🎯 Interview Q&A

**Q: Design a VPC for a web application with a database.**

A: Create VPC with /16 CIDR. Two public subnets (different AZs) for web tier. Two private subnets for DB tier. IGW attached, public route table pointing 0.0.0.0/0 → IGW. EC2 in public subnet with SG allowing 80/443 from internet, 22 from my IP. RDS in private subnet with SG allowing DB port only from EC2's SG. No public IP on RDS.

**Q: What's the difference between Security Groups and NACLs?**

A: SGs are instance-level and stateful (responses auto-allowed, only allow rules). NACLs are subnet-level and stateless (must allow both directions, can deny). SGs are your primary tool; NACLs add defense-in-depth.

**Q: Your RDS is in a private subnet. How do you connect from your laptop for debugging?**

A: SSH tunnel through EC2: `ssh -L 5432:rds-endpoint:5432 ec2-user@ec2-ip`. Your local port 5432 forwards through EC2 to RDS. Requires: EC2 SG allows SSH from your IP, RDS SG allows 5432 from EC2's SG.

**Q: Can two VPCs communicate with each other?**

A: Not by default — they're isolated. Options: VPC Peering (direct, non-transitive), Transit Gateway (hub-and-spoke for many VPCs), PrivateLink (expose specific services).

**Q: Why not just put RDS in a public subnet with a strong password?**

A: Defense in depth. Passwords can leak (env vars, logs, git). A private subnet means even with credentials, no one can reach the DB from the internet. The network topology itself is a security control, independent of application security.

---

## 🤔 Brainstorming Questions

1. **You have 3 microservices** that need to talk to each other but NOT to the internet. How do you network them? (Think: private subnets + SG chaining + service discovery)

2. **A new developer needs to debug RDS** from their laptop. What's the minimum access you'd grant? What if 10 developers need it? (Think: bastion host vs SSM Session Manager)

3. **Your EC2 is getting hit by a DDoS** from a specific IP range. Security Groups can't DENY. What do you do? (This is where NACLs shine.)

4. **You're designing for multi-region disaster recovery.** How do VPCs in different regions interact? What about overlapping CIDR blocks?

5. **If Security Groups are stateful, what does that mean for performance?** Does the firewall keep state in memory? What happens under very high connection counts?

---

*Previous: [Phase 1 — Networking Foundations](/aws-infrastructure/01-networking-foundations) · Next: [Phase 3 — SSH](/aws-infrastructure/03-ssh)*
