---
title: "Phase 11 — Monitoring, Logging & Maintenance"
description: "CloudWatch, structured logging, backups, patching — keeping your infrastructure healthy and observable."
order: 11
---

# Phase 11 — Monitoring, Logging & Maintenance

> **Category:** Operations · **Difficulty:** Intermediate · **Related:** CloudWatch · EC2 · RDS

---

## TLDR

Monitor everything: CPU, memory, disk, connections, errors, costs. Use CloudWatch for AWS metrics + alarms. Use structured logging (JSON) in your app so logs are searchable. Automate backups (RDS does it; EC2 needs AMI snapshots). Patch your EC2 regularly — you own it, you maintain it. Set billing alarms to avoid surprise charges.

---

## 01 — What to Monitor (Priority Order)

| What | Why | Alert Threshold |
|------|-----|-----------------|
| **Billing** | Avoid surprise charges | > $5 (free tier expected) |
| **EC2 CPU** | Detect overload | > 80% sustained 5min |
| **RDS connections** | Pool exhaustion | > 80% of max_connections |
| **RDS storage** | Runs out = crash | > 80% used |
| **Disk space (EC2)** | Logs fill up | > 80% used |
| **5xx error rate** | App is crashing | > 1% of requests |
| **Response time (P95)** | Performance degradation | > 2s |

---

## 02 — CloudWatch

### Key Metrics (Free)

```
EC2:
- CPUUtilization (%)
- NetworkIn/NetworkOut (bytes)
- StatusCheckFailed (instance health)

RDS:
- CPUUtilization
- FreeableMemory
- DatabaseConnections
- FreeStorageSpace
- ReadLatency / WriteLatency
```

### Setting Up Alarms

```bash
# Create a billing alarm (most important first!)
aws cloudwatch put-metric-alarm \
  --alarm-name "BillingOver5USD" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:billing-alerts

# EC2 CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "EC2-HighCPU" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --dimensions Name=InstanceId,Value=i-1234567890 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:ap-south-1:ACCOUNT:alerts
```

### Custom Metrics (Memory, Disk)

EC2 doesn't report memory/disk to CloudWatch by default. Install the CloudWatch Agent:

```bash
# Install CloudWatch Agent
sudo apt install amazon-cloudwatch-agent

# Configure (wizard or JSON)
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard

# Key metrics to add: mem_used_percent, disk_used_percent
```

---

## 03 — Application Logging (Structured)

### Why Structured (JSON) Logging?

```
❌ Unstructured: "User 123 logged in from 203.0.113.5 at 2024-01-15"
  → How do you search for all logins from IP 203.0.113.5? Regex nightmare.

✅ Structured:
{
  "level": "info",
  "message": "User logged in",
  "userId": 123,
  "ip": "203.0.113.5",
  "timestamp": "2024-01-15T10:30:00Z"
}
  → query: SELECT * WHERE ip = "203.0.113.5" → instant results
```

### Implementation (Winston for Node.js)

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Usage
logger.info('Order created', { orderId: 'abc-123', userId: 42, amount: 5000 });
logger.error('Payment failed', { orderId: 'abc-123', error: err.message, stack: err.stack });
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `error` | Something broke — needs attention |
| `warn` | Something unexpected but not broken (deprecations, retries) |
| `info` | Significant business events (user signup, order placed) |
| `debug` | Developer details (only in dev, never prod) |

### Shipping Logs to CloudWatch

Install CloudWatch Logs agent → logs become searchable in AWS Console, can trigger alarms on error patterns.

---

## 04 — Backups

### RDS (Automated)

```
Default:
- Automated daily snapshots (retained 7 days)
- Point-in-time recovery (restore to any second in last 7 days)
- Free tier: 20GB backup storage

Best practices:
- Increase retention to 14-30 days for production
- Test restore regularly (backups you've never tested aren't backups)
- Snapshots before schema migrations
```

### EC2 (Manual AMI Snapshots)

```bash
# Create AMI before risky changes
aws ec2 create-image \
  --instance-id i-1234567890 \
  --name "pre-deploy-2024-01-15" \
  --no-reboot    # Don't restart the instance

# Restore: Launch new instance from this AMI
# Instant rollback!
```

### Backup Strategy

```
                    What         How               Frequency
EC2 Server    → AMI snapshot     → Before deploys + weekly
RDS Database  → Automated backup → Daily (automatic)
App Code      → Git              → Every commit
Config/Env    → Secrets Manager  → Versioned automatically
Static Assets → S3 versioning    → Every upload
```

---

## 05 — Patching & Security Updates

### EC2 (Your Responsibility)

```bash
# Check for updates
sudo apt update
sudo apt list --upgradable

# Apply security patches
sudo apt upgrade -y

# Reboot if kernel updated
sudo reboot

# Automate with unattended-upgrades
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### RDS (AWS Manages)

- AWS handles engine patches
- You control the maintenance window (pick low-traffic time)
- Minor versions: auto-applied (opt-out possible)
- Major versions: you trigger manually

---

## 06 — Cost Monitoring (Free Tier Survival)

### Free Tier Limits (Year 1)

| Service | Free Limit | Alert When |
|---------|-----------|------------|
| EC2 | 750 hrs/month (t2/t3.micro) | Running 2+ instances |
| RDS | 750 hrs/month (db.t2/t3.micro) | Running 2+ instances |
| S3 | 5GB storage, 20K GET, 2K PUT | Approaching limits |
| Data Transfer | 15GB/month outbound | High traffic |
| Elastic IP | Free if attached to running instance | Unattached = charges |

### The $0.005/hour Traps

- Elastic IP not attached to running instance
- Stopped (not terminated) EBS volumes
- Old AMI snapshots accumulating
- NAT Gateway ($0.045/hr = $32/month!)

---

## 🧠 Quick Recall

1. What's the most important CloudWatch alarm to set up first?
2. Why structured logging over plain text?
3. What metrics does EC2 NOT report by default?
4. How do you restore from an RDS backup?
5. Who patches EC2? Who patches RDS?
6. What are the common free-tier cost traps?

---

## 🎯 Interview Q&A

**Q: How would you set up monitoring for a production web app on AWS?**

A: Layer 1: CloudWatch — CPU, memory (via agent), disk, RDS connections, billing alarms with SNS notifications. Layer 2: Application — structured JSON logging with request IDs for tracing, shipped to CloudWatch Logs. Layer 3: Uptime — external health check (Route 53 health checks or third-party). Layer 4: APM — distributed tracing (X-Ray or Datadog) for latency breakdown.

**Q: Your RDS runs out of storage at 3 AM. What happens and how do you prevent it?**

A: RDS stops accepting writes (read-only mode in some cases, or full outage). Prevention: CloudWatch alarm on FreeStorageSpace at 80%. Enable storage autoscaling (RDS can grow automatically up to a max you set). Regular monitoring dashboard review.

**Q: Explain the difference between CloudWatch Metrics, Logs, and Alarms.**

A: Metrics = numerical data points over time (CPU%, connection count). Logs = text records of events (application output, system logs). Alarms = rules that trigger actions when metrics cross thresholds ("if CPU > 80% for 5 min → send SNS notification"). Metrics feed alarms; Logs enable searching and pattern-based alerting.

---

## 🤔 Brainstorming Questions

1. **Your app is slow but CPU and memory look fine.** What else could cause latency? How would you diagnose it? (Network, DB queries, external API calls, connection pool exhaustion)

2. **You have 100GB of logs per day.** Storing in CloudWatch gets expensive. What's your log retention and tiering strategy? (Hot: 7 days searchable, Warm: 30 days in S3, Cold: archive after 90 days)

3. **An incident happened at 2:47 AM.** How do you reconstruct what happened? What logging practices would you wish you'd set up beforehand? (Request IDs, correlation IDs, structured events with full context)

4. **"Testing backups means testing restores."** How would you automate monthly RDS restore tests without disrupting production?

5. **Your monitoring shows 99.9% uptime.** But users complain it's slow. What metric are you missing? (Latency percentiles, not just availability. P50 vs P95 vs P99 matter more than "up/down".)

---

*Previous: [Phase 10 — AWS IAM](/aws-infrastructure/10-aws-iam) · Next: [Phase 12 — Advanced Topics](/aws-infrastructure/12-advanced-topics)*
