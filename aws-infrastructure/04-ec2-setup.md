---
title: "Phase 4 — EC2 Instance Setup"
description: "Setting up your Linux server — process management, software stack, pm2, systemd. Making your app production-ready."
order: 4
---

# Phase 4 — EC2 Instance Setup

> **Category:** Infrastructure · **Difficulty:** Intermediate · **Related:** Linux · NGINX · Deployment

---

## TLDR

EC2 is a blank Linux box. You install your runtime (Node/Python), deploy your app, and use a process manager (pm2/systemd) to keep it alive across crashes and reboots. NGINX sits in front. The process manager is what separates "it works when I'm SSH'd in" from "it works in production."

---

## 01 — The Real-World Analogy

EC2 is like renting an empty office:

| EC2 Concept | Office Analogy |
|------------|----------------|
| EC2 instance | Empty office space |
| AMI | Pre-furnished template |
| Instance type (t3.micro) | Size/power of the office |
| SSH | Walking in the front door with your key |
| Installing software | Furnishing the office |
| pm2/systemd | The office manager who ensures lights stay on |
| User data script | Move-in checklist executed on day 1 |

---

## 02 — Instance Types (What You're Paying For)

### t3.micro (Free Tier)

| Resource | Value |
|----------|-------|
| vCPUs | 2 (burstable) |
| RAM | 1 GB |
| Network | Low-moderate |
| Storage | EBS (8-30 GB typical) |
| Cost | Free for 750hrs/month (first year) |

### Burstable Performance (T-series)

T-instances use **CPU credits**. You earn credits when idle, spend them when busy:
- Baseline: ~20% CPU sustained
- Burst: 100% CPU (drains credits fast)
- Credits exhausted → throttled to baseline

> **Real-world:** Fine for low-traffic apps. Under sustained load (batch jobs, high traffic), switch to M-series (consistent performance).

### When to Upgrade

| Signal | Action |
|--------|--------|
| CPU credits hitting 0 regularly | Move to t3.small or m5.large |
| RAM at 90%+ | More RAM needed |
| >1000 req/sec sustained | Consider multiple instances + ALB |

---

## 03 — First-Time Server Setup

After SSH'ing into a fresh EC2 (Amazon Linux 2 or Ubuntu):

```bash
# Update everything first
sudo apt update && sudo apt upgrade -y   # Ubuntu
# or
sudo yum update -y                        # Amazon Linux

# Install essentials
sudo apt install -y git curl wget unzip htop

# Install Node.js (via nvm — recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20    # LTS
nvm use 20

# Verify
node --version    # v20.x.x
npm --version     # 10.x.x
```

### Directory Structure Convention

```
/home/ec2-user/        ← Your home dir
├── app/               ← Your application code
│   ├── package.json
│   ├── node_modules/
│   └── src/
├── .env               ← Environment variables (chmod 600!)
└── logs/              ← Application logs

/var/www/html/         ← Static frontend files (NGINX serves these)
/etc/nginx/            ← NGINX configuration
```

---

## 04 — Process Management: pm2

### The Problem

When you run `node app.js` and close your SSH terminal... your app dies. You need something to:
- Keep your app running after disconnect
- Restart on crashes
- Start automatically on server reboot
- Manage multiple app processes

### pm2 Setup

```bash
# Install globally
npm install -g pm2

# Start your app
pm2 start app.js --name "my-backend"

# Or with environment variables
pm2 start app.js --name "my-backend" -- --port 3000

# Essential commands
pm2 list               # See all running processes
pm2 logs my-backend    # Stream logs
pm2 restart my-backend # Restart
pm2 stop my-backend    # Stop
pm2 delete my-backend  # Remove from pm2

# CRITICAL: Survive reboots
pm2 startup            # Generates system startup script
pm2 save               # Saves current process list
```

### pm2 Ecosystem File (Production Config)

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'my-backend',
    script: './src/index.js',
    instances: 'max',        // Use all CPU cores (cluster mode)
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '500M',  // Restart if memory exceeds 500MB
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/output.log',
  }]
};

// Start with:
// pm2 start ecosystem.config.js
```

### pm2 Cluster Mode

On a 2-core machine, `instances: 'max'` runs 2 worker processes. NGINX (or pm2's built-in balancer) distributes requests across them. Double the throughput.

---

## 05 — Alternative: systemd Services

For non-Node apps or when you want OS-level management:

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Backend Application
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/app
ExecStart=/home/ec2-user/.nvm/versions/node/v20.11.0/bin/node src/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp

# Check status
sudo systemctl status myapp

# View logs
journalctl -u myapp -f
```

### pm2 vs systemd

| | pm2 | systemd |
|--|-----|---------|
| Language | Node.js specific | Any process |
| Cluster mode | ✅ Built-in | ❌ Manual (multiple services) |
| Log management | ✅ Built-in rotation | journald |
| Zero-downtime reload | ✅ `pm2 reload` | ❌ Stop/start gap |
| Monitoring | ✅ `pm2 monit` | Basic via systemctl |
| Best for | Node.js apps | Python, Go, Java, multi-language |

---

## 06 — Environment Variables (Secrets Management)

### The Hierarchy of Security

| Method | Security | When to Use |
|--------|----------|-------------|
| Hardcoded in code | ❌ Never | Never |
| `.env` file on EC2 | ✅ Minimum | Dev, small projects |
| AWS Secrets Manager | ✅✅ Better | Production |
| AWS SSM Parameter Store | ✅✅ Better | Production (cheaper) |
| IAM roles + no passwords | ✅✅✅ Best | AWS service access |

### .env File (Minimum Acceptable)

```bash
# /home/ec2-user/app/.env
DATABASE_URL=postgresql://admin:password@rds-endpoint:5432/mydb
JWT_SECRET=your-256-bit-random-string
AWS_REGION=ap-south-1

# IMPORTANT: Lock permissions
chmod 600 .env    # Only owner can read
```

```javascript
// In your app (using dotenv)
require('dotenv').config();
const dbUrl = process.env.DATABASE_URL;
```

### AWS Secrets Manager (Production)

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: 'ap-south-1' });
const secret = await client.send(new GetSecretValueCommand({
  SecretId: 'prod/myapp/database'
}));
const { username, password, host } = JSON.parse(secret.SecretString);
```

Benefits: automatic rotation, audit trail, no secrets on disk.

---

## 07 — User Data Scripts (Automate Setup)

When launching EC2, you can provide a "User Data" script that runs on first boot:

```bash
#!/bin/bash
# Runs as root on first boot

# Update system
yum update -y

# Install Node
curl -sL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# Install pm2
npm install -g pm2

# Clone app
cd /home/ec2-user
git clone https://github.com/you/your-app.git app
cd app
npm install --production

# Start with pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

> **Pro tip:** User Data runs ONCE (first boot). For repeatable setup, use AMIs (snapshot after setup → launch new instances from that AMI).

---

## 08 — AMI: Your Rollback Safety Net

### Create AMI Before Risky Changes

```
AWS Console → EC2 → Select Instance → Actions → Image → Create Image
```

If your deployment breaks everything, launch a new instance from the AMI — instant rollback.

### Golden AMI Pattern

```
Base AMI (Ubuntu 22.04)
  → Install Node, NGINX, pm2, monitoring agent
  → Harden SSH, update packages
  → Create "Golden AMI"
  
Every new instance launched from Golden AMI
  → Already has everything pre-installed
  → Just deploy your latest code
  → Production-ready in minutes
```

---

## 🧠 Quick Recall

1. What's the difference between pm2 and systemd?
2. Why do you need `pm2 startup` AND `pm2 save`?
3. Where should secrets live on EC2?
4. What's a "burstable" instance?
5. What does User Data do and when does it run?
6. What's the Golden AMI pattern?

---

## 🎯 Interview Q&A

**Q: Your Node.js app keeps crashing in production. How do you keep it running?**

A: pm2 with `Restart=on-failure` behavior. pm2 auto-restarts crashes, `pm2 startup` + `pm2 save` survives reboots. Add `max_memory_restart` for OOM protection. Add CloudWatch alarms for repeated crashes.

**Q: How would you deploy code to EC2 without downtime?**

A: pm2 cluster mode + `pm2 reload` (graceful). New processes start, old ones finish current requests, then exit. Zero dropped connections. For multiple EC2s: rolling deploy behind ALB.

**Q: .env files vs Secrets Manager — tradeoffs?**

A: .env is simpler but secrets sit on disk (leaked if instance compromised, no rotation, no audit). Secrets Manager: centralized, auto-rotation, audit trail, IAM-controlled — but adds latency on startup and cost ($0.40/secret/month).

**Q: What happens when your t3.micro runs out of CPU credits?**

A: Performance throttled to baseline (~20%). App becomes slow. Solutions: enable "unlimited" mode (pay per extra credit), upgrade instance type, or distribute load across multiple instances.

---

## 🤔 Brainstorming Questions

1. **You need to deploy the same app to 50 EC2 instances.** How? (Golden AMI + Auto Scaling vs containers + ECS)

2. **Your app needs 2GB RAM but you're on t3.micro (1GB).** What happens? How does Linux handle this? (OOM killer, swap)

3. **Should your deployment process use SSH at all?** What's wrong with "SSH in and git pull"? (Think: reproducibility, audit trail, rollback)

4. **pm2 cluster mode runs N processes.** But Node.js is single-threaded. How does this actually help? (Event loop per process, OS-level distribution)

5. **If IAM roles are "best practice" for EC2 secrets, why do most tutorials still use .env files?** What does this tell you about the gap between security best practices and developer experience?

---

*Previous: [Phase 3 — SSH](/aws-infrastructure/03-ssh) · Next: [Phase 5 — NGINX](/aws-infrastructure/05-nginx)*
