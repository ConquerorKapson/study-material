---
title: "SSH — Secure Server Access and Key-Based Authentication"
description: "Asymmetric cryptography, key pairs, SSH tunneling, and secure remote access patterns every engineer must master."
order: 3
---

# SSH — Secure Server Access and Key-Based Authentication

> **Category:** AWS Infrastructure · **Difficulty:** Beginner-Intermediate · **Related:** SSH · Cryptography · Key Pairs · Tunneling

---

## 01 — TLDR

- SSH (Secure Shell) provides **encrypted remote terminal access** over port 22 — it replaced Telnet, which sent everything in plaintext (including passwords!)
- It uses **asymmetric cryptography**: public key (padlock anyone can close) + private key (only you have the key to open it)
- In AWS: your **.pem file is sacred** — it's your private key. Lose it and you lose access. Leak it and everyone has access.
- **SSH tunneling** lets you securely access private resources (like RDS) through a public bastion host
- **Bastion hosts** (jump boxes) are the secure gateway pattern — one hardened entry point to reach private instances
- Modern alternative: **AWS SSM Session Manager** — no SSH keys, no open ports, full audit trail
- Production rule: never SSH directly to application servers. Use immutable infrastructure + centralized logging instead.

**Elevator pitch:** SSH is how you securely connect to remote machines. Understanding key-based authentication, tunneling, and bastion patterns is essential for managing any cloud infrastructure — and it's an interview staple.

---

## 02 — What Is SSH?

SSH (Secure Shell) is a protocol for **encrypted communication** between two machines. It provides:

1. **Remote terminal access** — run commands on a server from your laptop
2. **Secure file transfer** — SCP, SFTP
3. **Port forwarding / tunneling** — access remote services through encrypted channels
4. **Authentication** — prove who you are without sending passwords over the wire

### Why SSH Replaced Telnet

```
Telnet (1969-1990s):                    SSH (1995-present):
┌────────────────────────┐              ┌────────────────────────┐
│ Username: admin        │              │ ████████████████████   │
│ Password: hunter2      │              │ ████████████████████   │
│ $ rm -rf /important    │              │ ████████████████████   │
│                        │              │                        │
│ ALL PLAINTEXT!         │              │ ALL ENCRYPTED!         │
│ Anyone on the network  │              │ Interceptors see only  │
│ can read everything    │              │ garbage bytes           │
└────────────────────────┘              └────────────────────────┘
```

**The problem with Telnet:** Everything — usernames, passwords, commands, output — transmitted in plaintext. Anyone sniffing the network sees everything.

**SSH solved this:** All communication encrypted with strong cryptography. Even if someone intercepts the traffic, they see meaningless noise.

### SSH Key Facts

| Property | Value |
|---|---|
| Default port | 22 |
| Protocol version | SSH-2 (SSH-1 is deprecated, insecure) |
| Encryption | AES-256, ChaCha20 |
| Key exchange | Diffie-Hellman, ECDH |
| Authentication | Key-based (preferred) or password |
| Standard on | Every Linux/Mac server, Windows (OpenSSH built-in since Win10) |

---

## 03 — Asymmetric Cryptography Basics

SSH uses **asymmetric (public-key) cryptography**. Understanding this concept is crucial.

### The Padlock Analogy

Imagine you want someone to send you a locked box that only you can open:

```
Public Key = An open padlock you give to everyone
├── Anyone can CLOSE the padlock (encrypt a message)
├── You can hand out unlimited copies
└── It's PUBLICLY visible — no secrecy needed

Private Key = The only key that opens that padlock
├── Only YOU can open it (decrypt the message)
├── You NEVER share this
└── If someone gets this, game over
```

### How It Works for Authentication

```
The Magic:
1. Data encrypted with the PUBLIC key → only the PRIVATE key can decrypt it
2. Data signed with the PRIVATE key → the PUBLIC key can verify the signature

This means:
- Server has your public key → can create challenges only you can answer
- You have the private key → can prove you're you without revealing the key
- Even if someone intercepts the challenge, they can't forge your response
```

### Why This Is Brilliant for SSH

With password authentication:
- The password travels over the network (encrypted, but still)
- Server stores the password (or hash) — if server is breached, password leaks
- Passwords can be brute-forced

With key authentication:
- Private key **never leaves your machine**
- Server only has the public key (useless for impersonation)
- Keys are 2048-4096 bits — effectively impossible to brute-force
- No secrets transmitted during authentication

---

## 04 — Key-Pair Authentication Flow

### How AWS Key Pairs Work

When you create an EC2 instance:

```
Step 1: Key pair creation (happens once)
┌─────────┐                              ┌───────────┐
│   AWS   │── generates key pair ────────▶│  You get  │
│ Console │                              │  .pem file│
│         │── injects public key ──┐     │ (private  │
└─────────┘                        │     │  key)     │
                                   ▼     └───────────┘
                            ┌────────────┐
                            │ EC2 Instance│
                            │ ~/.ssh/     │
                            │ authorized_ │
                            │ keys        │
                            │ (public key)│
                            └────────────┘
```

### The SSH Authentication Handshake

```
Your Laptop                              EC2 Instance
(has private key)                        (has public key)
     │                                        │
     │─── 1. "Hi, I want to connect" ───────▶│
     │                                        │
     │◀── 2. Server sends a random           │
     │       challenge (encrypted with        │
     │       your public key)                 │
     │                                        │
     │    3. You decrypt with private key     │
     │       (only you can do this!)          │
     │                                        │
     │─── 4. Send back decrypted answer ────▶│
     │                                        │
     │    5. Server verifies: correct!        │
     │                                        │
     │◀── 6. "Welcome! Access granted" ──────│
     │                                        │
     │═══ 7. Encrypted session begins ═══════│
```

**The beauty:** Your private key never travels over the network. The server proves you have it by checking if you can decrypt something only the private key holder can decrypt.

---

## 05 — The .pem File

Your `.pem` file is the **single most sensitive file** in your AWS workflow. It IS your private key.

### What It Looks Like

```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdef...
(many lines of base64-encoded data)
...xyz987654321==
-----END RSA PRIVATE KEY-----
```

### Security Rules

| Rule | Why | Consequence of Violation |
|---|---|---|
| `chmod 400 my-key.pem` | Only owner can read | SSH refuses to connect if permissions are too open |
| Never commit to Git | Anyone with repo access gets server access | Immediate compromise of all instances using that key |
| Never email or Slack it | Transits through third-party servers | Key is exposed in message logs forever |
| Store encrypted (1Password, etc.) | Laptop theft = all servers compromised | Attacker can't use key without your vault password |
| Rotate periodically | Limits blast radius of undiscovered leaks | Old leaked keys stop working |

### What Happens with Wrong Permissions

```bash
$ ssh -i my-key.pem ec2-user@54.123.45.67

@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Permissions 0644 for 'my-key.pem' are too open.
It is required that your private key files are NOT accessible by others.
This private key will be ignored.
Load key "my-key.pem": bad permissions
Permission denied (publickey).
```

**Fix:**

```bash
# macOS/Linux
chmod 400 my-key.pem

# Windows (PowerShell)
icacls .\my-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

### AWS Key Pair Types

| Type | Algorithm | File Extension | Notes |
|---|---|---|---|
| RSA | RSA-2048 or RSA-4096 | .pem | Most compatible, industry standard |
| ED25519 | Ed25519 | .pem | Newer, faster, smaller keys, more secure |

> **Tech Lead recommendation:** Use ED25519 for new keys. It's faster, more secure, and produces smaller keys. RSA-2048 is fine for existing infrastructure.

---

## 06 — SSH Config File

The SSH config file (`~/.ssh/config`) is a **massive quality-of-life improvement**. Instead of typing long commands, you create shortcuts.

### Without Config (painful)

```bash
ssh -i ~/.ssh/my-production-key.pem -p 22 ec2-user@ec2-54-123-45-67.compute-1.amazonaws.com
```

### With Config (pleasant)

```bash
ssh production-web
```

### Config File Syntax

```ssh
# ~/.ssh/config

# Production web server
Host production-web
    HostName 54.123.45.67
    User ec2-user
    IdentityFile ~/.ssh/production-key.pem
    Port 22

# Staging database (through bastion)
Host staging-db
    HostName 10.0.2.50
    User ubuntu
    IdentityFile ~/.ssh/staging-key.pem
    ProxyJump staging-bastion

# Staging bastion (jump box)
Host staging-bastion
    HostName 34.56.78.90
    User ec2-user
    IdentityFile ~/.ssh/staging-key.pem

# Default settings for all connections
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
    AddKeysToAgent yes
    IdentitiesOnly yes
```

### Config Directives You Should Know

| Directive | Purpose | Example |
|---|---|---|
| `Host` | Alias name you'll type | `Host my-server` |
| `HostName` | Actual IP or DNS name | `54.123.45.67` |
| `User` | SSH username | `ec2-user`, `ubuntu` |
| `IdentityFile` | Path to private key | `~/.ssh/my-key.pem` |
| `Port` | SSH port (if not 22) | `2222` |
| `ProxyJump` | Jump through another host | `bastion` |
| `LocalForward` | Port forwarding | `5432 10.0.2.50:5432` |
| `ServerAliveInterval` | Keep connection alive (seconds) | `60` |
| `IdentitiesOnly` | Don't try other keys | `yes` |

---

## 07 — SSH Tunneling (Port Forwarding)

SSH tunneling creates an **encrypted passage** through which you can access services that aren't directly reachable. This is incredibly powerful.

### The Problem

```
Your Laptop ──── X ────▶ RDS Database (10.0.2.50:5432)
                          (private subnet, not reachable)
```

You can't connect directly to RDS in a private subnet from your laptop. The database has no public IP.

### The Solution: Local Port Forwarding

```
Your Laptop ────── SSH Tunnel ──────▶ EC2 Bastion ──────▶ RDS (10.0.2.50:5432)
                   (encrypted)         (public subnet)     (private subnet)

localhost:5432 ═══════════════════════════════════════════▶ 10.0.2.50:5432
```

**The command:**

```bash
ssh -L 5432:10.0.2.50:5432 ec2-user@bastion-ip -i my-key.pem
```

**Breaking it down:**

```
ssh -L [local_port]:[remote_host]:[remote_port] [user]@[bastion] -i [key]

-L 5432          : "On MY laptop, listen on port 5432"
10.0.2.50:5432   : "Forward traffic to RDS at 10.0.2.50:5432"
ec2-user@bastion : "Route through the bastion host"
```

**Now on your laptop:**

```bash
# This connects to RDS through the encrypted tunnel!
psql -h localhost -p 5432 -U myuser -d mydb

# Or in your database GUI (DBeaver, DataGrip):
# Host: localhost
# Port: 5432
# (It feels local, but traffic goes through the bastion to RDS)
```

### Diagram: How the Tunnel Works

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Your Laptop │     │   Bastion     │     │     RDS      │
│              │     │   (EC2)       │     │              │
│  localhost   │     │               │     │  10.0.2.50   │
│  :5432  ─────┼─────▶  Receives    ├─────▶  :5432       │
│              │ SSH │  tunneled     │ VPC │              │
│  DBeaver     │     │  traffic,    │     │  PostgreSQL  │
│  connects    │     │  forwards    │     │              │
│  here        │     │  to RDS      │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
      ENCRYPTED              PRIVATE NETWORK
```

### SSH Config for Tunneling

```ssh
# ~/.ssh/config

Host tunnel-production-db
    HostName 34.56.78.90
    User ec2-user
    IdentityFile ~/.ssh/production-key.pem
    LocalForward 5432 production-db.abc123.us-east-1.rds.amazonaws.com:5432
    LocalForward 6379 production-redis.abc123.cache.amazonaws.com:6379
```

Now just: `ssh tunnel-production-db` and both database and Redis are available on localhost.

### Other Tunnel Types

| Type | Flag | Use Case |
|---|---|---|
| Local forwarding | `-L` | Access remote service from your laptop |
| Remote forwarding | `-R` | Expose your local service to remote network |
| Dynamic (SOCKS) | `-D` | Route all traffic through the tunnel (like a VPN) |

```bash
# Dynamic tunnel (SOCKS proxy) — route browser through bastion
ssh -D 8080 ec2-user@bastion-ip

# Now configure browser: SOCKS proxy at localhost:8080
# All browsing goes through the bastion (useful for accessing internal dashboards)
```

---

## 08 — SCP and SFTP

Both use SSH for secure file transfer.

### SCP (Secure Copy) — Simple, One-Shot Transfers

```bash
# Copy file TO server
scp -i my-key.pem localfile.txt ec2-user@54.123.45.67:/home/ec2-user/

# Copy file FROM server
scp -i my-key.pem ec2-user@54.123.45.67:/var/log/app.log ./

# Copy entire directory (recursive)
scp -r -i my-key.pem ./deploy/ ec2-user@54.123.45.67:/opt/app/

# With SSH config alias
scp localfile.txt production-web:/home/ec2-user/
```

### SFTP (SSH File Transfer Protocol) — Interactive File Management

```bash
$ sftp -i my-key.pem ec2-user@54.123.45.67
Connected to 54.123.45.67.
sftp> ls
app/  logs/  config/
sftp> cd logs
sftp> get app.log
Fetching /home/ec2-user/logs/app.log to app.log
sftp> put new-config.yml config/
Uploading new-config.yml to /home/ec2-user/config/new-config.yml
sftp> exit
```

### When to Use Which

| Scenario | Tool | Why |
|---|---|---|
| Quick single file copy | SCP | Simplest syntax |
| Browse remote filesystem | SFTP | Interactive navigation |
| Automated deployment scripts | SCP or rsync | Scriptable |
| Sync large directory trees | rsync over SSH | Incremental, efficient |
| Sensitive file transfer | Either | Both encrypted via SSH |

```bash
# Rsync (the power tool) — only transfers CHANGED files
rsync -avz -e "ssh -i my-key.pem" ./build/ ec2-user@server:/opt/app/
# -a: archive mode (preserves permissions, timestamps)
# -v: verbose
# -z: compress during transfer
# -e: specify SSH command
```

---

## 09 — ssh-agent

`ssh-agent` manages your SSH keys in memory so you don't need to type passphrases repeatedly or specify key files every time.

### The Problem Without ssh-agent

```bash
# Every. Single. Time.
ssh -i ~/.ssh/key1.pem server1
ssh -i ~/.ssh/key2.pem server2
ssh -i ~/.ssh/key3.pem server3
# And if keys have passphrases: type password each time too
```

### Using ssh-agent

```bash
# Start the agent (usually auto-started on modern systems)
eval "$(ssh-agent -s)"

# Add your keys
ssh-add ~/.ssh/production-key.pem
ssh-add ~/.ssh/staging-key.pem

# Now connect without specifying -i
ssh ec2-user@54.123.45.67    # Agent automatically tries loaded keys

# List loaded keys
ssh-add -l

# Remove all keys (when you're done)
ssh-add -D
```

### macOS Keychain Integration

```ssh
# ~/.ssh/config (macOS)
Host *
    AddKeysToAgent yes
    UseKeychain yes         # macOS only — stores passphrase in Keychain
    IdentityFile ~/.ssh/id_ed25519
```

### Agent Forwarding (Use with Caution)

Agent forwarding lets you use your LOCAL keys on a REMOTE server — useful for jumping through bastions without placing keys on intermediate servers.

```bash
ssh -A ec2-user@bastion     # -A enables agent forwarding
# Now on bastion, you can SSH to other servers using YOUR local keys
ssh ec2-user@private-server  # Works! Uses your forwarded agent
```

⚠️ **Security warning:** Agent forwarding means anyone with root on the bastion can use your keys while you're connected. Prefer `ProxyJump` instead.

---

## 10 — Bastion Hosts / Jump Boxes

A bastion host is a **hardened, minimal server** in a public subnet that serves as the only SSH entry point to your private network.

### The Pattern

```
┌───────────────────────────────────────────────────────────────────────┐
│                              VPC                                        │
│                                                                         │
│  ┌─── Public Subnet ─────────┐    ┌─── Private Subnet ──────────┐    │
│  │                            │    │                              │    │
│  │  ┌──────────────────┐     │    │  ┌──────────────────┐       │    │
│  │  │  Bastion Host    │     │    │  │  App Server 1    │       │    │
│  │  │  (t3.micro)      │◀────┼────│──│  (no public IP)  │       │    │
│  │  │                  │     │    │  └──────────────────┘       │    │
│  │  │  SG: port 22     │     │    │                              │    │
│  │  │  from office IP  │     │    │  ┌──────────────────┐       │    │
│  │  │  ONLY            │     │    │  │  App Server 2    │       │    │
│  │  └──────────────────┘     │    │  │  (no public IP)  │       │    │
│  │                            │    │  └──────────────────┘       │    │
│  └────────────────────────────┘    │                              │    │
│                                     │  ┌──────────────────┐       │    │
│                                     │  │  RDS Database    │       │    │
│                                     │  │  (no public IP)  │       │    │
│                                     │  └──────────────────┘       │    │
│                                     └──────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▲
                    │ SSH (port 22)
           ┌───────┴────────┐
           │  Your Laptop   │
           │  (office IP)   │
           └────────────────┘
```

### Why Bastion Hosts?

| Without Bastion | With Bastion |
|---|---|
| Every server needs public IP | Only bastion has public IP |
| Many entry points to secure | Single entry point to audit |
| Large attack surface | Minimal attack surface |
| Hard to audit access | All access flows through one point |
| SG rules everywhere | SG rules concentrated |

### Connecting Through a Bastion (ProxyJump)

**Old way (manual two-hop):**

```bash
# Step 1: SSH to bastion
ssh -i key.pem ec2-user@bastion-ip
# Step 2: From bastion, SSH to private instance
ssh -i key.pem ec2-user@10.0.2.50
```

**Modern way (ProxyJump — single command):**

```bash
ssh -J ec2-user@bastion-ip ec2-user@10.0.2.50 -i key.pem
```

**Best way (SSH config):**

```ssh
# ~/.ssh/config
Host bastion
    HostName 34.56.78.90
    User ec2-user
    IdentityFile ~/.ssh/production-key.pem

Host private-app
    HostName 10.0.2.50
    User ec2-user
    IdentityFile ~/.ssh/production-key.pem
    ProxyJump bastion
```

```bash
# Now just:
ssh private-app
# Automatically jumps through bastion!
```

### Bastion Hardening Checklist

| Item | Implementation |
|---|---|
| Minimal software | Only SSH daemon, nothing else |
| Restricted SG | Port 22 from office/VPN IPs ONLY |
| No data storage | No application code, no databases |
| Session logging | All commands logged to CloudWatch |
| MFA (optional) | Google Authenticator PAM module |
| Auto-shutdown | Stop instance outside business hours |
| Patch immediately | Automated security updates |
| Monitor access | CloudTrail + GuardDuty alerts |

---

## 11 — Step-by-Step: Connect to Your First EC2 Instance

### Prerequisites

- EC2 instance running (Amazon Linux 2 or Ubuntu)
- Key pair (.pem file) downloaded during instance creation
- Security Group allows SSH (port 22) from your IP

### Full Command Sequence

```bash
# 1. Find your .pem file
ls ~/Downloads/my-key.pem

# 2. Fix permissions (REQUIRED — SSH rejects keys with open permissions)
chmod 400 ~/Downloads/my-key.pem

# 3. Get the public IP from AWS Console (or CLI)
aws ec2 describe-instances --query 'Reservations[].Instances[].PublicIpAddress'
# Output: "54.123.45.67"

# 4. Connect!
ssh -i ~/Downloads/my-key.pem ec2-user@54.123.45.67
# For Ubuntu AMIs: ubuntu@54.123.45.67
# For Debian: admin@54.123.45.67

# 5. First time: verify host fingerprint
# The authenticity of host '54.123.45.67' can't be established.
# ED25519 key fingerprint is SHA256:abc123...
# Are you sure you want to continue connecting (yes/no)? yes

# 6. You're in!
[ec2-user@ip-10-0-1-50 ~]$ whoami
ec2-user
[ec2-user@ip-10-0-1-50 ~]$ hostname
ip-10-0-1-50.ec2.internal
```

### Troubleshooting Connection Issues

| Error | Likely Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` | Wrong key file or wrong username | Check key matches instance's key pair; try `ec2-user` or `ubuntu` |
| `Connection timed out` | Security Group blocking | Ensure SG allows port 22 from YOUR IP |
| `Connection refused` | SSH not running or wrong port | Check instance is running; verify port 22 |
| `UNPROTECTED PRIVATE KEY FILE` | File permissions too open | `chmod 400 my-key.pem` |
| `Host key verification failed` | Server changed (new instance, same IP) | Remove old entry from `~/.ssh/known_hosts` |

---

## 12 — Interview Deep-Dive: SSH Key Authentication

> **"How does SSH key authentication work? Why is it more secure than passwords?"**

**The comprehensive answer:**

"SSH key authentication uses asymmetric cryptography — a mathematically linked pair of keys where the public key encrypts and the private key decrypts.

**Setup phase:**
The public key is placed on the server (in `~/.ssh/authorized_keys`). The private key stays on the client machine, never shared.

**Authentication flow:**
When I connect, the server generates a random challenge, encrypts it with my public key, and sends it. Only my private key can decrypt this challenge. I decrypt it, hash it with the session ID, and send back the proof. The server verifies this matches — confirming I possess the private key without the key itself ever crossing the network.

**Why it's more secure than passwords:**
1. **No secret transmission** — the private key never leaves my machine
2. **Immune to brute force** — 2048+ bit keys have astronomically more combinations than any password
3. **No server-side secret storage** — the server only stores the public key, which is useless for impersonation
4. **Phishing-resistant** — I can't accidentally type my key into a fake login page
5. **Key rotation** — I can revoke a public key instantly without the holder knowing my 'password'

The only risk is the private key file being stolen, which is why we protect it with strict file permissions, passphrase encryption, and never commit it to version control."

---

## 13 — "What Would Go Wrong If..." Scenarios

### Scenario 1: .pem File Leaked (Committed to Git)

**What happens:** Anyone who clones the repository now has your private key and can SSH into your servers.

**Blast radius:**
- 🔴 All EC2 instances using that key pair are compromised
- 🔴 Attacker can pivot to private network resources
- 🔴 Data exfiltration, cryptocurrency mining, lateral movement

**Immediate response:**
```bash
# 1. Remove the key from Git history (not just the latest commit!)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/key.pem' HEAD

# 2. Generate new key pair in AWS Console

# 3. Update authorized_keys on ALL instances using the old key
# (or terminate and relaunch with new key pair)

# 4. Delete the compromised key pair from AWS

# 5. Audit CloudTrail for unauthorized access during exposure window
```

**Prevention:**
- `.gitignore` all `.pem` files: `*.pem`
- Use `git-secrets` or pre-commit hooks to catch accidental commits
- Store keys in a secrets manager (1Password, Vault)

### Scenario 2: SSH Open to 0.0.0.0/0

```
Security Group:
  Inbound: TCP 22 from 0.0.0.0/0    ← 🔴 THE ENTIRE INTERNET
```

**What happens:** Every automated scanner on the internet (and there are millions) will find your server within minutes and begin brute-force attempts.

**Evidence:** Check `/var/log/auth.log` on any public server:

```
Failed password for root from 103.42.xxx.xxx port 45678 ssh2
Failed password for admin from 185.22.xxx.xxx port 12345 ssh2
Failed password for ubuntu from 91.134.xxx.xxx port 54321 ssh2
# Thousands of these per day from botnets
```

**Mitigation:**
- Restrict to your office/VPN CIDR: `22 from 203.0.113.0/24`
- Use AWS SSM Session Manager (no port 22 needed at all)
- Add fail2ban (auto-blocks IPs after N failed attempts)

### Scenario 3: No Key Rotation

**What happens:** Keys created 3 years ago are still in use. Former employees who had the .pem file still have access.

**Risk:** Ex-employees, lost laptops from years ago, old backups — all still valid access vectors.

**The fix:**
- Rotate keys quarterly (at minimum)
- When employees leave: immediately generate new key pair, update `authorized_keys` on all instances
- Better: Use AWS SSM (access controlled by IAM policies, revocable instantly)

---

## 14 — Tech Lead Decision: SSH vs SSM Session Manager

### AWS Systems Manager Session Manager

SSM Session Manager provides shell access to EC2 instances **without SSH**:

| Feature | SSH | SSM Session Manager |
|---|---|---|
| Open port required | ✅ Port 22 | ❌ No inbound ports |
| Key management | ✅ You manage .pem files | ❌ Uses IAM roles |
| Bastion needed | ✅ For private subnets | ❌ Works with private subnets directly |
| Audit trail | ⚠️ Manual setup (CloudTrail + logging) | ✅ Built-in (every command logged) |
| Access revocation | ⚠️ Rotate keys manually | ✅ Remove IAM permission instantly |
| Cost | 🟢 Free | 🟢 Free |
| Works without internet | ❌ Need connectivity | ✅ VPC endpoint available |
| File transfer | ✅ SCP/SFTP | ⚠️ Limited (use S3) |
| Port forwarding | ✅ Native | ✅ Supported |

### When to Use Each

| Scenario | Recommendation |
|---|---|
| Production instances | 🟢 SSM — better security, full audit trail |
| Development/debugging | 🟡 Either — SSH is fine for dev |
| Compliance requirements | 🟢 SSM — built-in session logging |
| Temporary troubleshooting | 🟢 SSM — no key distribution needed |
| Long interactive sessions | 🟡 SSH — more stable for long sessions |
| Legacy instances (no SSM agent) | SSH — only option |
| Database access (port forwarding) | SSH tunneling or SSM port forwarding |

### SSM Session Example

```bash
# No key file! No public IP! Just IAM permissions.
aws ssm start-session --target i-0abc123def456

Starting session with SessionId: user-0abc123def456...
sh-4.2$ whoami
ssm-user
sh-4.2$ # Full shell access, every command logged to CloudWatch
```

> **Tech Lead recommendation:** For new projects, default to SSM Session Manager. It eliminates entire categories of security issues (key management, port exposure, bastion maintenance). Only fall back to SSH when SSM isn't an option (legacy AMIs, specific tooling requirements).

---

## 15 — Security Hardening Checklist

### SSH Server Configuration (`/etc/ssh/sshd_config`)

```bash
# Disable password authentication (key-only)
PasswordAuthentication no
ChallengeResponseAuthentication no

# Disable root login
PermitRootLogin no

# Use SSH protocol 2 only (1 is insecure)
Protocol 2

# Restrict to specific users
AllowUsers ec2-user deploy-bot

# Idle timeout (disconnect after 5 min inactive)
ClientAliveInterval 300
ClientAliveCountMax 0

# Limit authentication attempts
MaxAuthTries 3

# Change default port (security through obscurity — minor benefit)
# Port 2222

# Disable X11 forwarding (not needed for servers)
X11Forwarding no

# Disable TCP forwarding if not needed
# AllowTcpForwarding no
```

### Hardening Steps

| Step | Command / Action | Priority |
|---|---|---|
| Disable password auth | Edit `sshd_config` | 🔴 Critical |
| Disable root login | `PermitRootLogin no` | 🔴 Critical |
| Key-only authentication | Remove all passwords | 🔴 Critical |
| Restrict Security Group | Port 22 from specific CIDRs only | 🔴 Critical |
| Install fail2ban | `apt install fail2ban` | 🟡 Important |
| Enable CloudWatch logging | Install CW agent, ship auth.log | 🟡 Important |
| Set up key rotation | Quarterly key rotation procedure | 🟡 Important |
| Use Ed25519 keys | `ssh-keygen -t ed25519` | 🟢 Recommended |
| Limit SSH users | `AllowUsers` directive | 🟢 Recommended |
| Consider port change | Non-standard port | ⚠️ Minor benefit |

### fail2ban Configuration

```ini
# /etc/fail2ban/jail.local
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3          # Ban after 3 failed attempts
bantime = 3600        # Ban for 1 hour
findtime = 600        # Within 10 minute window
```

---

## 16 — Generating Your Own Key Pairs

You don't always need AWS to generate keys. You can create your own:

```bash
# Generate Ed25519 key (recommended)
ssh-keygen -t ed25519 -C "your-email@company.com"
# Generates: ~/.ssh/id_ed25519 (private) + ~/.ssh/id_ed25519.pub (public)

# Generate RSA 4096-bit key (maximum compatibility)
ssh-keygen -t rsa -b 4096 -C "your-email@company.com"
# Generates: ~/.ssh/id_rsa (private) + ~/.ssh/id_rsa.pub (public)

# Import public key to AWS
aws ec2 import-key-pair \
  --key-name "my-custom-key" \
  --public-key-material fileb://~/.ssh/id_ed25519.pub
```

### Adding Your Key to a Running Instance

```bash
# From your laptop, copy public key to the server
cat ~/.ssh/id_ed25519.pub | ssh -i existing-key.pem ec2-user@server \
  "cat >> ~/.ssh/authorized_keys"

# Or manually on the server
echo "ssh-ed25519 AAAA...your-public-key... your-email" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

## 17 — Real-World Access Patterns

### Pattern 1: Development Team Access

```
┌─────────────────────────────────────────────────────────────────┐
│ Team Access Pattern                                              │
│                                                                   │
│ Developer A ──┐                                                  │
│ Developer B ──┼──▶ VPN ──▶ Bastion ──▶ Dev/Staging instances    │
│ Developer C ──┘            (SSH)        (Private subnet)         │
│                                                                   │
│ CI/CD (GitHub Actions) ──▶ SSM ──▶ Production instances         │
│                            (No SSH, IAM-based)                    │
│                                                                   │
│ On-call Engineer ──▶ SSM ──▶ Any instance (emergency)           │
│                       (Full audit trail, time-limited)            │
└─────────────────────────────────────────────────────────────────┘
```

### Pattern 2: Zero-Trust Access (Modern)

```
Developer → AWS SSO → IAM Role → SSM Session Manager → Instance
                                      │
                                      ├── Session logged to CloudWatch
                                      ├── Access auto-expires after 1 hour
                                      └── No keys, no ports, full audit
```

### Pattern 3: Database Access for Developers

```bash
# In SSH config:
Host tunnel-prod-db
    HostName bastion.company.com
    User developer
    IdentityFile ~/.ssh/company-key.pem
    LocalForward 5433 prod-db.internal:5432

# Connect:
ssh tunnel-prod-db
# In another terminal:
psql -h localhost -p 5433 -U readonly_user -d production
```

---

## 18 — Key Takeaways

| Concept | One-Liner |
|---|---|
| SSH | Encrypted remote access — replaced plaintext Telnet |
| Asymmetric crypto | Public key locks, private key unlocks — private key never leaves your machine |
| .pem file | Your private key — chmod 400, never share, never commit |
| SSH config | Aliases + shortcuts = productivity × 10 |
| Tunneling (-L) | Encrypted bridge to private resources through public bastion |
| Bastion host | Single hardened entry point to private network |
| SCP/SFTP | Secure file transfer over SSH |
| ssh-agent | Key manager — load keys once, use everywhere |
| SSM Session Manager | Modern alternative — no keys, no ports, full audit |
| Key rotation | Change keys regularly — former employees shouldn't retain access |

> **Final thought:** SSH mastery is a force multiplier. Every debugging session, every deployment, every database query in production flows through SSH (or SSM). The engineer who understands tunneling, config files, and bastion patterns is 10x more effective at incident response than one who Googles the command every time.

---

*Previous: [VPC, Subnets, and Security Groups](./vpc-subnets-security-groups.md) — the network architecture these SSH connections plug into.*
