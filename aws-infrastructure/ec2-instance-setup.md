---
title: "EC2 Instance Setup — From Blank Server to Running Application"
description: "Linux fundamentals, process management with pm2/systemd, software stack installation, and production-ready EC2 configuration."
order: 4
---

# EC2 Instance Setup — From Blank Server to Running Application

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate · **Related:** EC2 · Linux · pm2 · systemd · Node.js

---

## 01 — TLDR

- EC2 gives you a blank Linux box in the cloud — you're responsible for everything on it
- Choose the right instance type: t2/t3 micro for dev, burstable credits matter under load
- Linux basics (file permissions, package management, environment variables) are non-negotiable
- Your app MUST run under a process manager (pm2 or systemd) — never raw `node app.js`
- User Data scripts automate first-boot setup but must be idempotent
- EBS volumes persist across stops; instance store does NOT
- Production readiness = process manager + log rotation + monitoring + auto-restart

**Why this matters:** Every cloud deployment ultimately runs on a server. Even with containers and serverless, understanding EC2 setup gives you the mental model for debugging anything in production.

---

## 02 — EC2 Instance Types

### The Burstable Model (T-series)

| Instance | vCPUs | RAM | Baseline CPU | Credit Rate | Best For |
|----------|-------|-----|--------------|-------------|----------|
| t2.micro | 1 | 1 GB | 10% | 6/hour | Free tier, tiny apps |
| t2.small | 1 | 2 GB | 20% | 12/hour | Light workloads |
| t3.micro | 2 | 1 GB | 10% | 12/hour | Better networking |
| t3.small | 2 | 2 GB | 20% | 24/hour | Small production apps |

### CPU Credits Explained

Think of CPU credits like a prepaid phone plan:

- You earn credits at a steady rate when idle
- You spend credits when CPU usage exceeds baseline
- **t2.micro baseline:** 10% of one CPU core continuously
- If you spike to 100% CPU, you burn credits 10x faster than you earn them
- **When credits hit zero:** your instance is throttled to baseline (feels like molasses)

```bash
# Check your credit balance
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUCreditBalance \
  --dimensions Name=InstanceId,Value=i-1234567890abcdef0 \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 300 \
  --statistics Average
```

### t2 vs t3 — Which to Pick

| Feature | t2 | t3 |
|---------|----|----|
| CPU credits | Standard only | Unlimited mode available |
| Network | Moderate | Better burst |
| Pricing | Slightly cheaper | Better value |
| Nitro platform | ❌ | ✅ |
| Recommendation | Legacy, avoid | ✅ Use this |

> **Interview Callout:** "What happens when a t2.micro runs out of CPU credits?" — The instance isn't stopped, but CPU is throttled to 10% baseline. Your app becomes unresponsive. This is a common cause of "the server is slow" in dev environments.

---

## 03 — AMI (Amazon Machine Image)

### What It Is

An AMI is a **snapshot/template** of an entire machine:
- Operating system
- Pre-installed software
- Configuration files
- Boot instructions

Think of it like a "ghost image" of a hard drive — you stamp out identical machines from it.

### Common AMI Choices

| AMI | Package Manager | Init System | Notes |
|-----|-----------------|-------------|-------|
| Amazon Linux 2023 | dnf/yum | systemd | AWS-optimized, fast boot, free |
| Amazon Linux 2 | yum | systemd | Legacy, still widely used |
| Ubuntu 22.04 LTS | apt | systemd | Most tutorials written for this |
| Ubuntu 24.04 LTS | apt | systemd | Latest LTS |
| Debian 12 | apt | systemd | Minimal, stable |

### How to Pick

- **Learning/tutorials:** Ubuntu (most documentation available)
- **Production on AWS:** Amazon Linux 2023 (optimized for AWS, security patches auto-applied)
- **Consistency with local dev:** Match your dev environment (Ubuntu if you develop on Ubuntu)
- **Enterprise:** Whatever your company standardizes on

### Custom AMIs

You can create your own AMI from a configured instance:

```bash
# After setting up your instance perfectly
aws ec2 create-image \
  --instance-id i-1234567890abcdef0 \
  --name "my-app-base-v1.2" \
  --description "Node 20 + NGINX + pm2 pre-configured"
```

This is the basis of "golden images" — pre-baked servers ready to launch.

---

## 04 — Linux Basics You Need

### File System Structure

```
/
├── etc/          # Configuration files (nginx.conf, systemd services)
├── var/
│   ├── log/     # System and application logs
│   ├── www/     # Web server document root (sometimes)
│   └── lib/     # Variable data (databases, package info)
├── home/
│   └── ec2-user/  # Your user's home directory (or ubuntu/)
├── opt/          # Optional software (good place for your app)
├── usr/
│   ├── bin/     # User binaries (installed programs)
│   └── local/   # Locally compiled software
├── tmp/          # Temporary files (cleared on reboot)
└── root/         # Root user's home (don't use this)
```

**Where to put your app:**
- `/home/ec2-user/myapp` — Simple, works for single-app servers
- `/opt/myapp` — More "production" convention
- `/var/www/myapp` — Web-specific convention

### File Permissions

```bash
# Permission format: rwxrwxrwx (owner-group-others)
# r=4, w=2, x=1

ls -la
# -rw-r--r-- 1 ec2-user ec2-user 1234 Jan 1 12:00 app.js
#  ^^^         owner    group
#  owner: read+write
#      ^^^
#      group: read only
#          ^^^
#          others: read only

# Common permission patterns
chmod 755 script.sh    # Owner: rwx, Group: r-x, Others: r-x (executable scripts)
chmod 644 config.json  # Owner: rw-, Group: r--, Others: r-- (config files)
chmod 600 .env         # Owner: rw-, Group: ---, Others: --- (secrets!)
chmod 700 .ssh/        # Owner: rwx, Group: ---, Others: --- (SSH directory)

# Change ownership
chown ec2-user:ec2-user /opt/myapp -R    # Recursive ownership change
chown www-data:www-data /var/www/html -R  # For web server files
```

> **Critical Rule:** Never run your application as root. Create a dedicated user or use the default ec2-user.

### Users and Groups

```bash
# Create app-specific user (no login shell, no home directory)
sudo useradd --system --no-create-home --shell /bin/false appuser

# Add user to a group
sudo usermod -aG nginx ec2-user

# Check who you are
whoami
id     # Shows uid, gid, and groups

# Switch user
sudo su - ec2-user
```

### Environment Variables

```bash
# Set for current session
export NODE_ENV=production
export PORT=3000
export DATABASE_URL="postgresql://user:pass@host:5432/db"

# Persist across sessions (add to ~/.bashrc or ~/.profile)
echo 'export NODE_ENV=production' >> ~/.bashrc
source ~/.bashrc

# Set for a single command
NODE_ENV=production node app.js

# View all environment variables
env | grep NODE

# For pm2 - use ecosystem file (see section 08)
# For systemd - use Environment= or EnvironmentFile= (see section 09)
```

---

## 05 — Package Management

### apt (Ubuntu/Debian)

```bash
# Update package index (ALWAYS do this first)
sudo apt update

# Upgrade installed packages
sudo apt upgrade -y

# Install packages
sudo apt install -y git curl wget build-essential

# Search for packages
apt search nginx

# Remove packages
sudo apt remove nginx
sudo apt autoremove  # Clean up unused dependencies
```

### yum/dnf (Amazon Linux)

```bash
# Update packages
sudo yum update -y          # Amazon Linux 2
sudo dnf update -y          # Amazon Linux 2023

# Install packages
sudo yum install -y git curl gcc-c++ make

# Amazon Linux extras (AL2 only)
sudo amazon-linux-extras install nginx1 -y
```

### Installing Node.js with nvm

**Never install Node.js from the system package manager** — you'll get an old version.

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js
nvm install 20         # Install Node 20 (LTS)
nvm use 20            # Use Node 20
nvm alias default 20  # Set as default

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x
```

### Installing Python

```bash
# Ubuntu
sudo apt install -y python3 python3-pip python3-venv

# Amazon Linux 2023
sudo dnf install -y python3.11 python3.11-pip

# Verify
python3 --version
pip3 --version
```

### Installing Git and Cloning Your Repo

```bash
# Install Git
sudo apt install -y git   # Ubuntu
sudo yum install -y git   # Amazon Linux

# Configure (for commits from server)
git config --global user.name "Deploy Bot"
git config --global user.email "deploy@example.com"

# Clone via HTTPS (simpler)
git clone https://github.com/yourorg/yourapp.git /opt/myapp

# Clone via SSH (more secure, needs key setup)
git clone git@github.com:yourorg/yourapp.git /opt/myapp
```

---

## 06 — The Software Stack

### Layer Diagram

```
┌─────────────────────────────────────────────┐
│           Client (Browser)                   │
└─────────────────┬───────────────────────────┘
                  │ HTTPS (port 443)
┌─────────────────▼───────────────────────────┐
│         NGINX (Reverse Proxy)                │
│   • SSL termination                          │
│   • Static file serving                      │
│   • Rate limiting                            │
│   • Security headers                         │
└─────────────────┬───────────────────────────┘
                  │ HTTP (port 3000, localhost only)
┌─────────────────▼───────────────────────────┐
│         Process Manager (pm2)                │
│   • Auto-restart on crash                    │
│   • Cluster mode (multi-core)                │
│   • Log management                           │
│   • Startup persistence                      │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│         Application (Node.js/Python)         │
│   • Business logic                           │
│   • API routes                               │
│   • Database connections                     │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│         Runtime (Node.js 20 / Python 3.11)   │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│         Operating System (Amazon Linux/Ubuntu)│
│   • File system, networking, users           │
│   • systemd (service management)             │
│   • Security updates                         │
└─────────────────────────────────────────────┘
```

### Why Each Layer Matters

| Layer | What Happens Without It |
|-------|------------------------|
| NGINX | Backend exposed directly, no SSL, no static file caching |
| Process Manager | App dies on crash or SSH disconnect, no one restarts it |
| Application | Nothing to serve |
| Runtime | Can't execute your code |
| OS | Nothing works |

---

## 07 — Complete Walkthrough: SSH to Running App

### Step 1: Connect to Your Instance

```bash
# Set correct permissions on your key file
chmod 400 my-key.pem

# Connect
ssh -i my-key.pem ec2-user@54.123.45.67
# Or for Ubuntu AMI:
ssh -i my-key.pem ubuntu@54.123.45.67
```

### Step 2: Update the System

```bash
sudo apt update && sudo apt upgrade -y   # Ubuntu
# OR
sudo yum update -y                        # Amazon Linux
```

### Step 3: Install Node.js

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Install Node 20
nvm install 20
nvm alias default 20
```

### Step 4: Clone Your App

```bash
# Create app directory
sudo mkdir -p /opt/myapp
sudo chown ec2-user:ec2-user /opt/myapp

# Clone
git clone https://github.com/yourorg/myapp.git /opt/myapp
cd /opt/myapp
```

### Step 5: Install Dependencies

```bash
npm ci --production   # ci is faster and more reliable than install for deploys
```

### Step 6: Set Environment Variables

```bash
# Create .env file (or use a secrets manager)
cat > /opt/myapp/.env << 'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@rds-host:5432/mydb
JWT_SECRET=your-secret-here
EOF

chmod 600 /opt/myapp/.env   # Restrict access
```

### Step 7: Install and Start pm2

```bash
# Install pm2 globally
npm install -g pm2

# Start your app
cd /opt/myapp
pm2 start app.js --name "myapp" --env production

# Verify it's running
pm2 status
pm2 logs myapp --lines 20

# Make pm2 survive reboots
pm2 startup    # Follow the printed command (copy-paste it)
pm2 save       # Save current process list
```

### Step 8: Verify

```bash
# Test locally
curl http://localhost:3000/health
# Should return: {"status": "ok"}

# Check if port is listening
ss -tlnp | grep 3000
```

---

## 08 — Process Management with pm2

### Why You Need It

```bash
# This is what happens WITHOUT a process manager:
ssh -i key.pem ec2-user@server
node app.js &     # Starts in background
exit              # Disconnects SSH
# ❌ Your app is now DEAD — the process was tied to your SSH session

# Even with & (background), the SIGHUP signal kills it when SSH disconnects
# nohup helps but doesn't handle crashes:
nohup node app.js &   # Survives disconnect, but if it crashes, it stays dead
```

### Core pm2 Commands

```bash
# Start
pm2 start app.js --name "api"
pm2 start app.js --name "api" -i max    # Cluster mode (all CPU cores)
pm2 start app.js --name "api" -i 2      # 2 instances

# Manage
pm2 restart api          # Restart
pm2 reload api           # Zero-downtime reload (cluster mode)
pm2 stop api             # Stop
pm2 delete api           # Remove from pm2 list

# Monitor
pm2 status               # Quick overview
pm2 monit                # Real-time dashboard
pm2 logs api             # Stream logs
pm2 logs api --lines 100 # Last 100 lines

# Info
pm2 show api             # Detailed process info
pm2 env api              # Environment variables
```

### Ecosystem File (ecosystem.config.js)

For complex setups, use a config file:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'api',
      script: './src/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Restart conditions
      max_memory_restart: '500M',
      max_restarts: 10,
      min_uptime: '10s',
      // Logs
      log_file: '/var/log/myapp/combined.log',
      error_file: '/var/log/myapp/error.log',
      out_file: '/var/log/myapp/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Watch (dev only, not for production)
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
    }
  ]
};
```

```bash
# Start with ecosystem file
pm2 start ecosystem.config.js

# Restart with updated config
pm2 restart ecosystem.config.js --update-env
```

### Startup Persistence (Survive Reboots)

```bash
# Generate startup script (run the command it outputs!)
pm2 startup
# Output: sudo env PATH=$PATH:/home/ec2-user/.nvm/... pm2 startup systemd -u ec2-user --hp /home/ec2-user
# ^^^ COPY AND RUN THIS COMMAND

# Save current process list
pm2 save

# Now if the server reboots, pm2 auto-starts your apps
```

### pm2 Log Rotation

```bash
# Install log rotation module
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 09 — systemd Services

### When to Use systemd vs pm2

| Feature | pm2 | systemd |
|---------|-----|---------|
| Node.js specific | ✅ Designed for it | ⚠️ Works but generic |
| Cluster mode | ✅ Built-in | ❌ Manual |
| Zero-downtime reload | ✅ | ❌ |
| Log management | ✅ Built-in | ✅ journalctl |
| Any language | ⚠️ Node-focused | ✅ Anything |
| OS-level integration | ❌ | ✅ Native |
| Boot ordering | ❌ | ✅ After=network.target |
| Resource limits | ❌ | ✅ cgroups |

**Rule of thumb:** Use pm2 for Node.js apps. Use systemd for everything else (Python, Go, Java) or when you need tight OS integration.

### Writing a systemd Service File

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Node.js Application
Documentation=https://github.com/yourorg/myapp
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/myapp
ExecStart=/home/ec2-user/.nvm/versions/node/v20.11.0/bin/node src/server.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

# Environment
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/myapp/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/myapp/logs /opt/myapp/uploads

# Resource limits
MemoryMax=512M
CPUQuota=80%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=myapp

[Install]
WantedBy=multi-user.target
```

### systemd Commands

```bash
# Reload after editing service file
sudo systemctl daemon-reload

# Enable (start on boot)
sudo systemctl enable myapp

# Start/stop/restart
sudo systemctl start myapp
sudo systemctl stop myapp
sudo systemctl restart myapp

# Check status
sudo systemctl status myapp

# View logs
sudo journalctl -u myapp -f            # Follow logs (like tail -f)
sudo journalctl -u myapp --since today  # Today's logs
sudo journalctl -u myapp -n 50          # Last 50 lines
```

> **Interview Callout:** "Your app crashes at 3am — how do you ensure it auto-restarts?"
>
> "I use pm2 with `max_restarts` and `min_uptime` configured, plus `pm2 startup` so it persists across reboots. The ecosystem config sets `Restart=on-failure` behavior. For non-Node apps, I use systemd with `Restart=on-failure` and `RestartSec=5`. Both approaches ensure the app comes back automatically. I also have CloudWatch alarms on the health check endpoint so I get notified if it keeps crashing."

---

## 10 — User Data Scripts

### What It Is

User Data is a bash script that runs **once** when an EC2 instance first boots. It runs as root.

```bash
#!/bin/bash
# This runs on FIRST BOOT ONLY (by default)

# Update system
yum update -y

# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20

# Install app
git clone https://github.com/yourorg/myapp.git /opt/myapp
cd /opt/myapp
npm ci --production

# Install and configure pm2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user

# Signal completion (for CloudFormation)
/opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} --resource MyInstance --region ${AWS::Region}
```

### Idempotency Concerns

⚠️ **User Data only runs on first launch by default.** But if you're building AMIs or using launch templates:

```bash
#!/bin/bash
# Make it idempotent — safe to run multiple times

# Use a flag file to prevent re-running
if [ -f /var/lib/cloud/instance/user-data-ran ]; then
    echo "User data already ran, skipping"
    exit 0
fi

# ... your setup code ...

# Mark as complete
touch /var/lib/cloud/instance/user-data-ran
```

### Debugging User Data

```bash
# View User Data output log
cat /var/log/cloud-init-output.log

# Check if it ran
cloud-init status

# Force re-run (careful!)
sudo cloud-init clean
sudo cloud-init init
```

---

## 11 — Instance Storage vs EBS

### Comparison

| Feature | Instance Store | EBS (Elastic Block Store) |
|---------|---------------|---------------------------|
| Persistence | ❌ Lost on stop/terminate | ✅ Persists independently |
| Speed | 🟢 Very fast (local NVMe) | 🟡 Network-attached |
| Use case | Temp data, caches, buffers | OS, app data, databases |
| Cost | Included with instance | Separate charges |
| Snapshots | ❌ | ✅ Point-in-time backups |
| Resize | ❌ | ✅ Grow without downtime |

### EBS Volume Types

| Type | IOPS | Throughput | Use Case | Cost |
|------|------|-----------|----------|------|
| gp3 | 3,000 base (up to 16,000) | 125 MB/s (up to 1,000) | ✅ Default choice | $ |
| gp2 | Burst to 3,000 | 128-250 MB/s | Legacy, avoid | $ |
| io2 | Up to 64,000 | Up to 1,000 MB/s | Databases needing consistent IOPS | $$$ |
| st1 | 500 | 500 MB/s | Big data, log processing | ¢ |
| sc1 | 250 | 250 MB/s | Cold storage, infrequent access | ¢ |

### EBS Snapshots

```bash
# Create a snapshot (point-in-time backup)
aws ec2 create-snapshot \
  --volume-id vol-1234567890abcdef0 \
  --description "Pre-deployment backup $(date +%Y-%m-%d)"

# Automate with lifecycle policies
aws dlm create-lifecycle-policy \
  --description "Daily snapshots, 7-day retention" \
  --state ENABLED \
  --execution-role-arn arn:aws:iam::123456789:role/dlm-role \
  --policy-details file://snapshot-policy.json
```

### Disk Space Monitoring

```bash
# Check disk usage
df -h

# Find large files
du -sh /var/log/*
du -sh /opt/myapp/node_modules

# Set up CloudWatch alarm for disk usage
# (requires CloudWatch agent installed)
```

---

## 12 — "What Would Go Wrong If..." Scenarios

### Running as Root

```bash
# ❌ BAD: Running app as root
sudo node app.js
```

**What goes wrong:**
- If your app has a vulnerability, attacker gets ROOT access to entire server
- Files created by app are owned by root (permission nightmares)
- Can accidentally modify system files
- No privilege separation between app and OS

**Fix:** Always run as a non-root user (ec2-user or dedicated app user).

### No Process Manager

```bash
# ❌ BAD: Running directly
node app.js
# Or even:
node app.js &
```

**What goes wrong:**
- SSH disconnect kills the process
- App crash = permanent downtime until someone manually restarts
- No log rotation (stdout fills disk)
- No restart limits (infinite crash loop eats CPU)
- No memory monitoring (memory leak crashes server)

### EBS Full Disk

**What goes wrong:**
- Application can't write logs → crashes
- Database can't write → data corruption
- OS can't write to /tmp → system instability
- `apt/yum` can't update → security vulnerability
- Even `ssh` might fail if /var is full

**Prevention:**
```bash
# Monitor with CloudWatch agent
# Set alarm at 80% disk usage
# Implement log rotation
# Regularly clean /tmp and old logs
sudo find /var/log -name "*.gz" -mtime +30 -delete
```

### CPU Credit Exhaustion on t2.micro

**What goes wrong:**
- Response times spike from 50ms to 5000ms
- Health checks fail → load balancer marks instance unhealthy
- Users experience timeouts
- Auto-scaling might not help if new instances also deplete credits

**Prevention:**
- Monitor `CPUCreditBalance` metric
- Use t3 with unlimited mode (charges extra but doesn't throttle)
- Right-size: if consistently above 20% CPU, upgrade

---

## 13 — Tech Lead Decision: Scale Up vs Scale Out

### When to Move to a Larger Instance (Scale Up)

| Signal | Action |
|--------|--------|
| CPU consistently > 60% | Upgrade instance type |
| Memory constantly > 80% | Upgrade to more RAM |
| Single-threaded app bottleneck | Upgrade CPU speed |
| Database on same server | Upgrade or separate |

### When to Scale Horizontally (Scale Out)

| Signal | Action |
|--------|--------|
| Traffic spikes at specific times | Auto Scaling Group |
| Need high availability | Multiple instances + ALB |
| Stateless app design | Add instances behind load balancer |
| Multi-region requirement | Instances in multiple AZs |

### Decision Framework

```
Is your app stateless?
├── YES → Scale horizontally (ASG + ALB)
│         • Cheaper (many small instances)
│         • Fault tolerant
│         • Handles traffic spikes
│
└── NO → Fix statefulness first
          • Move sessions to Redis/DynamoDB
          • Move uploads to S3
          • Move database to RDS
          • THEN scale horizontally
```

> **Rule of Thumb:** It's almost always better to scale out than up. Vertical scaling has hard limits; horizontal scaling is theoretically infinite.

---

## 14 — Production Readiness Checklist

| Category | Item | Status |
|----------|------|--------|
| **Process** | App runs under pm2/systemd | ⬜ |
| **Process** | Auto-restart on crash configured | ⬜ |
| **Process** | Survives server reboot (pm2 startup + save) | ⬜ |
| **Security** | App runs as non-root user | ⬜ |
| **Security** | .env file has 600 permissions | ⬜ |
| **Security** | SSH key-only auth (no password) | ⬜ |
| **Security** | Security group: only 22, 80, 443 open | ⬜ |
| **Security** | Automatic security updates enabled | ⬜ |
| **Storage** | EBS volume with adequate space | ⬜ |
| **Storage** | Snapshot schedule configured | ⬜ |
| **Storage** | Log rotation in place | ⬜ |
| **Monitoring** | CloudWatch alarms (CPU, disk, memory) | ⬜ |
| **Monitoring** | Health check endpoint exists | ⬜ |
| **Monitoring** | Application-level logging | ⬜ |
| **Network** | Elastic IP attached (if needed) | ⬜ |
| **Network** | NGINX reverse proxy configured | ⬜ |
| **Network** | SSL/TLS certificate installed | ⬜ |
| **Backup** | Deployment rollback plan exists | ⬜ |
| **Backup** | EBS snapshot automation | ⬜ |
| **Docs** | Runbook for common issues | ⬜ |

---

## 15 — Common Troubleshooting

### "I can't SSH into my instance"

```bash
# Check security group allows port 22 from your IP
# Check the key file permissions (must be 400)
chmod 400 my-key.pem

# Check you're using the right username
# Amazon Linux: ec2-user
# Ubuntu: ubuntu
# Debian: admin

# Check instance is running and has public IP
aws ec2 describe-instances --instance-ids i-xxx --query 'Reservations[].Instances[].{State:State.Name,IP:PublicIpAddress}'
```

### "App works locally but not on EC2"

```bash
# Check if the app is actually running
pm2 status
curl http://localhost:3000/health

# Check if the port is open in security group
# (port 3000 should NOT be open — NGINX handles external traffic)

# Check environment variables are set
pm2 env myapp

# Check logs for errors
pm2 logs myapp --lines 50 --err
```

### "Server is slow"

```bash
# Check CPU credits (t2/t3)
# Check memory usage
free -m
# Check disk I/O
iostat -x 1 5
# Check network
ss -s
# Check for zombie processes
ps aux | grep Z
```

---

## 16 — Key Takeaways

1. **Instance selection matters** — t3.micro for dev, right-size for production based on actual load
2. **Linux fundamentals are non-negotiable** — permissions, package management, file system structure
3. **Never run without a process manager** — pm2 for Node.js, systemd for everything else
4. **The stack has layers** — OS → Runtime → App → Process Manager → Reverse Proxy
5. **EBS is your persistent storage** — instance store is ephemeral, snapshots are your backup
6. **Automate everything** — User Data for setup, pm2 startup for persistence, CloudWatch for monitoring
7. **Security is not optional** — non-root user, restricted permissions, security groups as firewall
