---
title: "Phase 3 — SSH: Secure Server Access"
description: "How SSH works — key pairs, tunneling, config files. Your lifeline to managing remote servers."
order: 3
---

# Phase 3 — SSH: Secure Server Access

> **Category:** Infrastructure · **Difficulty:** Beginner → Intermediate · **Related:** EC2 · Security · Cryptography

---

## TLDR

SSH = encrypted remote terminal. Uses asymmetric crypto (public key on server, private key on your laptop). The `.pem` file IS your identity — lose it, lose access; leak it, attacker gets access. SSH tunneling lets you reach private resources (RDS) through your EC2 as a jump box.

---

## 01 — The Real-World Analogy

Think of SSH like a bank vault:

| SSH Concept | Vault Analogy |
|------------|---------------|
| Public key | The lock on the vault (anyone can see it) |
| Private key (.pem) | Your unique key that opens that lock |
| SSH connection | Walking into the vault through an encrypted corridor |
| SSH tunnel | A secret passage from vault A through vault B to vault C |
| `authorized_keys` | The list of key shapes the lock accepts |

---

## 02 — How SSH Authentication Works

### Asymmetric Cryptography (The Core)

SSH uses [asymmetric cryptography](/aws-infrastructure/00-glossary#asymmetric-cryptography):

```
Key Generation (one time):
  → Private key: complex_secret_number (stays on YOUR laptop)
  → Public key:  derived_from_private (goes on the SERVER)

Authentication (every connection):
  Server: "Prove you have the private key matching this public key"
  Client: *signs a challenge with private key*
  Server: *verifies signature with public key* → ✅ Access granted
```

**No password crosses the network.** The private key never leaves your machine. The server only has the public key — even if the server is compromised, your private key is safe.

### The AWS Flow

```
1. You launch EC2 → AWS generates key pair
2. Public key → placed in EC2's ~/.ssh/authorized_keys
3. Private key (.pem) → downloaded to your laptop (ONCE!)
4. You connect:
   ssh -i mykey.pem ec2-user@54.23.1.100
5. Your client proves identity → server verifies → you're in
```

---

## 03 — Protecting Your Private Key

### Why It's Sacred

| If someone gets your .pem | They can... |
|--------------------------|-------------|
| Download it from your repo | SSH into your server, access everything |
| Read it from your laptop | Full server access |
| Access it via malware | Deploy backdoors, steal data |

### Security Rules (Non-Negotiable)

```bash
# 1. Restrict permissions (FIRST thing after download)
chmod 400 mykey.pem    # Read-only by owner, no one else

# 2. NEVER commit to git
echo "*.pem" >> .gitignore

# 3. NEVER share via Slack/email/etc.

# 4. Store in a secure location (~/.ssh/ with proper permissions)
mv mykey.pem ~/.ssh/mykey.pem
```

> SSH will REFUSE to use a key file with overly permissive permissions. `chmod 400` isn't optional — it's enforced.

---

## 04 — SSH Config File (Productivity Hack)

Instead of typing long commands every time:

```bash
# Without config:
ssh -i ~/.ssh/mykey.pem ec2-user@54.23.1.100

# With ~/.ssh/config:
ssh myserver
```

### Config File Setup

```
# ~/.ssh/config
Host myserver
    HostName 54.23.1.100
    User ec2-user
    IdentityFile ~/.ssh/mykey.pem
    
Host staging
    HostName 10.0.1.55
    User ubuntu
    IdentityFile ~/.ssh/staging-key.pem
    ProxyJump myserver    # Jump through myserver to reach staging
```

Now `ssh myserver` connects directly. `ssh staging` routes through myserver first (for private instances).

---

## 05 — SSH Tunneling (Critical for RDS Access)

### The Problem

RDS is in a private subnet — you can't connect from your laptop directly. But your EC2 CAN reach RDS (they're in the same VPC).

### The Solution: Local Port Forwarding

```bash
ssh -i mykey.pem -L 5432:my-rds-endpoint.rds.amazonaws.com:5432 ec2-user@54.23.1.100
```

What this does:

```
Your Laptop              EC2 (Jump Box)              RDS (Private)
localhost:5432  ═══SSH Tunnel═══►  ──────────────►  :5432
     ↑                                                    ↑
Your DB client                            Actual database
connects here                             lives here
```

Now open pgAdmin/DBeaver → connect to `localhost:5432` → you're talking to RDS through the encrypted tunnel.

### How the -L Flag Works

```
-L local_port:remote_host:remote_port

-L 5432:rds-endpoint:5432
   │         │          │
   │         │          └── RDS port
   │         └── RDS hostname (as seen from EC2)
   └── Your laptop port to bind
```

### Other Tunnel Types

| Flag | Name | Direction | Use Case |
|------|------|-----------|----------|
| `-L` | Local forward | Laptop → Remote | Access RDS from laptop |
| `-R` | Remote forward | Remote → Laptop | Expose local dev to internet |
| `-D` | Dynamic (SOCKS) | Laptop → Any | Route ALL traffic through EC2 |

---

## 06 — SCP/SFTP: File Transfer

### SCP (Secure Copy)

```bash
# Upload file to EC2
scp -i mykey.pem ./deploy.sh ec2-user@54.23.1.100:/home/ec2-user/

# Download file from EC2
scp -i mykey.pem ec2-user@54.23.1.100:/var/log/app.log ./

# Upload entire directory
scp -r -i mykey.pem ./my-app/ ec2-user@54.23.1.100:/home/ec2-user/
```

### When to Use What

| Tool | Use Case |
|------|----------|
| `scp` | Quick one-off file copies |
| `rsync` | Large/incremental transfers (only sends changes) |
| `sftp` | Interactive file browsing |
| Git + CI/CD | Production deployments (preferred) |

---

## 07 — ssh-agent (Key Management)

Tired of typing `-i mykey.pem` every time? `ssh-agent` holds your keys in memory:

```bash
# Start agent
eval $(ssh-agent)

# Add key (prompts for passphrase if set)
ssh-add ~/.ssh/mykey.pem

# Now just:
ssh ec2-user@54.23.1.100    # Agent provides the key automatically

# List loaded keys
ssh-add -l
```

---

## 08 — Hardening SSH (Production)

### Changes to `/etc/ssh/sshd_config` on EC2:

```bash
# Disable password auth (key-only)
PasswordAuthentication no

# Disable root login
PermitRootLogin no

# Only allow specific users
AllowUsers ec2-user deploy-bot

# Change default port (optional, minor security-by-obscurity)
# Port 2222

# Restart SSH daemon after changes
sudo systemctl restart sshd
```

### Fail2Ban (Rate Limiting)

```bash
sudo apt install fail2ban
# Auto-blocks IPs after repeated failed SSH attempts
# Default: 5 failures = 10min ban
```

---

## 🧠 Quick Recall

1. What's the difference between public and private keys in SSH?
2. Why does SSH refuse keys with chmod 644?
3. How does SSH tunneling let you access RDS from your laptop?
4. What's the `-L` flag syntax mean?
5. Why disable password authentication on production servers?

---

## 🎯 Interview Q&A

**Q: Explain how SSH key-pair authentication works.**

A: Server has public key in `authorized_keys`. Client has private key. On connection, server sends a challenge. Client signs it with private key. Server verifies signature with public key. If valid → access granted. No password ever crosses the network.

**Q: You lost your .pem file. How do you regain access to EC2?**

A: Options: (1) If you have another key pair authorized, use that. (2) Stop instance → detach root volume → attach to another instance → edit authorized_keys → reattach → start. (3) Use EC2 Instance Connect or SSM Session Manager if configured. (4) Create AMI → launch new instance with new key.

**Q: How would you give 10 developers SSH access without sharing one key?**

A: Each developer generates their own key pair. Add each public key to EC2's `authorized_keys` file. Or better: use AWS SSM Session Manager (no SSH keys needed, uses IAM for access control, audit trail built-in).

**Q: SSH tunnel vs VPN for accessing private resources?**

A: SSH tunnel = single port forwarded, lightweight, no extra software. VPN = full network access to the private subnet, heavier setup. For one developer debugging RDS → tunnel. For a team needing broad access → VPN or SSM.

---

## 🤔 Brainstorming Questions

1. **SSH uses asymmetric crypto for auth, but symmetric crypto for the data stream.** Why not use asymmetric for everything? (Think performance.)

2. **If your EC2 gets compromised**, the attacker has the public keys in `authorized_keys`. Can they use these to impersonate the developers? Why/why not?

3. **You need to give a CI/CD bot SSH access for deployments.** Should it use a personal key? A shared key? Something else? What are the security tradeoffs?

4. **Why does AWS only let you download the .pem ONCE?** What security principle does this enforce?

5. **SSH tunneling is basically a poor man's VPN.** When does it break down? At what scale does a proper VPN become necessary?

---

*Previous: [Phase 2 — VPC, Subnets, Security Groups](/aws-infrastructure/02-vpc-subnets-security-groups) · Next: [Phase 4 — EC2 Setup](/aws-infrastructure/04-ec2-setup)*
