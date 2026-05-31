---
title: "Monitoring, Logging, and Maintenance — Keeping Production Alive"
description: "CloudWatch metrics and alarms, structured logging, application monitoring, backup strategies, patching, and the operational practices that prevent 3am wake-ups."
order: 11
---

# Monitoring, Logging, and Maintenance — Keeping Production Alive

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate-Advanced · **Related:** CloudWatch · Logging · Alarms · Backups · AMI · Patching

---

## 01 — TL;DR

- **You can't fix what you can't see** — monitoring is not optional, it's the difference between proactive and reactive ops
- **Three pillars of observability:** Metrics (numbers over time), Logs (event records), Traces (request journeys)
- **CloudWatch** is AWS's native monitoring — metrics, alarms, logs, dashboards, all integrated
- **Billing alarms** are the FIRST alarm you create — a $500 surprise bill is a real AWS rite of passage
- **Structured logging** (JSON) is searchable and parseable; unstructured logs are just expensive storage
- **Alert on symptoms, not causes** — "response time > 2s" not "CPU > 80%" (CPU might spike during deploys)
- **Backups are useless if never tested** — schedule quarterly restore drills
- **Patching EC2 is YOUR responsibility** — RDS patches itself, but OS-level updates are on you

**Why this matters:** The quality of your monitoring directly predicts your team's sleep quality. Good monitoring means you find problems before customers do. Bad monitoring means 3am PagerDuty alerts and panicked debugging with no data.

---

## 02 — Why Monitoring Matters

### The Three Pillars of Observability

| Pillar | What It Is | Example | Tool |
|--------|-----------|---------|------|
| **Metrics** | Numerical measurements over time | CPU usage, request count, error rate | CloudWatch Metrics |
| **Logs** | Discrete event records | "User X logged in", "Payment failed: insufficient funds" | CloudWatch Logs |
| **Traces** | End-to-end request journey | Request → API Gateway → Lambda → DynamoDB (250ms total) | X-Ray |

### How They Complement Each Other

```
Scenario: Users report slow page loads

Metrics tell you:  "Response time spiked to 5s at 14:30"
Logs tell you:     "Database query for /api/products took 4.2s"
Traces tell you:   "The slow query hits table X, which is missing an index"
```

Without metrics, you wouldn't know there's a problem.
Without logs, you wouldn't know which component is slow.
Without traces, you wouldn't know the root cause.

### The Monitoring Maturity Ladder

| Level | Description | Outcome |
|-------|-------------|---------|
| 0 — None | "Is the site down?" "I don't know" | Customers report problems |
| 1 — Basic | Uptime check (is it responding?) | Know when it's fully down |
| 2 — Metrics | CPU, memory, error rates | Know when it's degraded |
| 3 — Alerting | Automated notifications | Team knows within minutes |
| 4 — Dashboards | Real-time visibility | Team sees trends, prevents issues |
| 5 — Proactive | Anomaly detection, capacity planning | Fix issues before users notice |

---

## 03 — CloudWatch Metrics

CloudWatch collects metrics from all AWS services automatically. No setup needed for basic metrics.

### Built-in EC2 Metrics (Free, automatic)

| Metric | What It Measures | Alert Threshold (typical) |
|--------|-----------------|--------------------------|
| `CPUUtilization` | CPU usage (%) | > 80% sustained |
| `NetworkIn` / `NetworkOut` | Bytes transferred | Anomaly from baseline |
| `DiskReadOps` / `DiskWriteOps` | IOPS | Near provisioned limit |
| `StatusCheckFailed` | Instance health | Any failure = critical |
| `StatusCheckFailed_System` | Host hardware health | Any failure = migrate instance |

### Built-in RDS Metrics

| Metric | What It Measures | Alert Threshold |
|--------|-----------------|-----------------|
| `DatabaseConnections` | Active connections | > 80% of max_connections |
| `FreeStorageSpace` | Available disk | < 20% remaining |
| `ReadIOPS` / `WriteIOPS` | Database IOPS | Near provisioned limit |
| `CPUUtilization` | DB CPU usage | > 80% sustained |
| `FreeableMemory` | Available RAM | < 10% of total |
| `ReplicaLag` | Read replica delay | > 5 seconds |

### What CloudWatch Does NOT Capture (You Need the Agent)

| Metric | Why It's Missing | Solution |
|--------|-----------------|----------|
| Memory utilization | EC2 hypervisor can't see inside OS | CloudWatch Agent |
| Disk space (%) | Same — OS-level metric | CloudWatch Agent |
| Process count | OS-level | CloudWatch Agent |
| Application metrics | Your custom logic | Custom metrics via SDK |

### Custom Metrics

```javascript
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const cw = new CloudWatchClient({ region: 'us-east-1' });

// Report a custom metric
await cw.send(new PutMetricDataCommand({
  Namespace: 'MyApp/Production',
  MetricData: [{
    MetricName: 'OrdersProcessed',
    Value: 42,
    Unit: 'Count',
    Dimensions: [
      { Name: 'Environment', Value: 'production' },
      { Name: 'Service', Value: 'order-processor' }
    ]
  }]
}));
```

### Namespaces and Dimensions

```
Namespace:  AWS/EC2              (AWS built-in)
            MyApp/Production     (your custom namespace)

Dimensions: InstanceId=i-abc123  (which specific resource)
            Environment=prod     (logical grouping)
```

---

## 04 — CloudWatch Alarms

Alarms watch a metric and trigger actions when it crosses a threshold.

### Alarm States

| State | Meaning | Color |
|-------|---------|-------|
| `OK` | Metric is within threshold | 🟢 Green |
| `ALARM` | Metric breached threshold | 🔴 Red |
| `INSUFFICIENT_DATA` | Not enough data points yet | 🟡 Yellow |

### Creating an Alarm (AWS CLI)

```bash
# CPU alarm: alert if CPU > 80% for 5 minutes
aws cloudwatch put-metric-alarm \
  --alarm-name "HighCPU-Production" \
  --alarm-description "CPU usage above 80% for 5 minutes" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=InstanceId,Value=i-0abc123def456 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:AlertsTeam \
  --ok-actions arn:aws:sns:us-east-1:123456789012:AlertsTeam
```

### Complete Alert Pipeline

```
┌─────────┐     ┌────────────┐     ┌─────────┐     ┌──────────────┐
│ Metric  │────▶│ CloudWatch │────▶│  SNS    │────▶│ Destinations │
│ (CPU)   │     │  Alarm     │     │  Topic  │     │              │
└─────────┘     └────────────┘     └─────────┘     │ • Email      │
                                                     │ • SMS        │
                                                     │ • PagerDuty  │
                                                     │ • Lambda     │
                                                     │ • Slack      │
                                                     └──────────────┘
```

### Setting Up SNS for Notifications

```bash
# Create an SNS topic
aws sns create-topic --name AlertsTeam
# Returns: arn:aws:sns:us-east-1:123456789012:AlertsTeam

# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:AlertsTeam \
  --protocol email \
  --notification-endpoint team@company.com

# Subscribe a Lambda for auto-remediation
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:AlertsTeam \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:AutoRemediate
```

### Composite Alarms

Combine multiple alarms with AND/OR logic to reduce noise:

```bash
# Only alert if BOTH CPU is high AND error rate is high
aws cloudwatch put-composite-alarm \
  --alarm-name "ProductionDegraded" \
  --alarm-rule "ALARM(HighCPU-Production) AND ALARM(HighErrorRate-Production)"
```

---

## 05 — Billing Alarms

> **This is the FIRST alarm you create. No exceptions.**

### Why

AWS charges are **usage-based** and can spike unexpectedly:
- Forgot to terminate a test instance → $100/month
- Auto Scaling went wild → $500 in a day
- Data transfer between regions → $200 surprise
- Provisioned IOPS you forgot about → $300/month

### Setup (Console or CLI)

```bash
# Enable billing alerts first (one-time, in us-east-1 only)
# Then create the alarm:
aws cloudwatch put-metric-alarm \
  --alarm-name "BillingAlarm-50USD" \
  --alarm-description "Alert when estimated charges exceed $50" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=Currency,Value=USD \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:BillingAlerts \
  --region us-east-1
```

### Recommended Billing Alarm Tiers

| Threshold | Action |
|-----------|--------|
| $10 | Email notification (sanity check) |
| $50 | Email + SMS (investigate) |
| $100 | Email + SMS + Slack (stop everything, check now) |
| $500 | Email + SMS + phone call (emergency) |

---

## 06 — Application Logging

### Structured vs Unstructured Logs

**❌ Unstructured (hard to search):**

```
[2024-01-15 10:30:45] ERROR - Something went wrong processing order 12345 for user john@example.com
```

**✅ Structured JSON (machine-parseable):**

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "error",
  "message": "Order processing failed",
  "orderId": "12345",
  "userId": "usr_abc123",
  "error": "InsufficientInventory",
  "service": "order-processor",
  "traceId": "abc-123-def"
}
```

### Why Structured Wins

| Feature | Unstructured | Structured JSON |
|---------|-------------|-----------------|
| Search by field | ❌ Regex gymnastics | ✅ `{ $.orderId = "12345" }` |
| Dashboard aggregation | ❌ Manual parsing | ✅ Count errors by type |
| Alert on patterns | ⚠️ Fragile regex | ✅ Filter expressions |
| Cross-service correlation | ❌ Nearly impossible | ✅ traceId joins |
| Cost (CloudWatch Logs) | Same | Same |

### Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `error` | Something broke, needs attention | Failed payment, DB connection lost |
| `warn` | Concerning but not broken | Retry succeeded, approaching limit |
| `info` | Normal operations worth recording | User logged in, order placed |
| `debug` | Development details | SQL query, cache hit/miss |

**Production rule:** Run at `info` level by default. Enable `debug` temporarily during incidents.

### What to Log vs What to NEVER Log

| ✅ Always Log | ❌ Never Log |
|--------------|-------------|
| Request ID / Trace ID | Passwords / secrets |
| User ID (anonymized) | Full credit card numbers |
| Operation performed | API keys / tokens |
| Error details + stack trace | PII (email, phone, address) |
| Response time | Health data (HIPAA) |
| HTTP status code | Session tokens |

> **What would go wrong if you log PII:** GDPR fine up to €20 million or 4% of revenue. CCPA fines. Log aggregators indexed it. Now you need to purge from all log stores, replicas, and backups. **Don't.**

---

## 07 — Logging Libraries

### Winston (Node.js — Most Popular)

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'order-api',
    environment: process.env.NODE_ENV
  },
  transports: [
    // Console (for CloudWatch agent to pick up)
    new winston.transports.Console(),
    // File rotation (backup)
    new winston.transports.File({
      filename: '/var/log/app/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Usage
logger.info('Order created', { orderId: '12345', userId: 'usr_abc', amount: 99.99 });
logger.error('Payment failed', { orderId: '12345', error: err.message, stack: err.stack });
```

### Pino (Node.js — Faster)

```javascript
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  base: {
    service: 'order-api',
    env: process.env.NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

// Pino is ~5x faster than Winston (important at high throughput)
logger.info({ orderId: '12345', userId: 'usr_abc' }, 'Order created');
```

### Python Logging

```python
import logging
import json
from datetime import datetime

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "service": "order-api",
            "module": record.module,
        }
        if record.exc_info:
            log_entry["stack_trace"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)

logger = logging.getLogger("app")
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)
logger.setLevel(logging.INFO)

logger.info("Order created", extra={"orderId": "12345"})
```

---

## 08 — CloudWatch Logs

### Architecture

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│ Your App        │     │ CloudWatch Agent   │     │ CloudWatch Logs  │
│ (writes to      │────▶│ (reads stdout or   │────▶│                  │
│  stdout/file)   │     │  log files)        │     │ Log Group:       │
└─────────────────┘     └───────────────────┘     │ /app/production  │
                                                    │                  │
                                                    │ Log Streams:     │
                                                    │ ├── i-abc123     │
                                                    │ ├── i-def456     │
                                                    │ └── i-ghi789     │
                                                    └──────────────────┘
```

### CloudWatch Agent Configuration

```json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/app/app.log",
            "log_group_name": "/app/production",
            "log_stream_name": "{instance_id}",
            "timezone": "UTC",
            "retention_in_days": 30
          },
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/nginx/production",
            "log_stream_name": "{instance_id}",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"]
      },
      "disk": {
        "measurement": ["disk_used_percent"],
        "resources": ["/"]
      }
    }
  }
}
```

### Installing and Starting the Agent

```bash
# Install on Amazon Linux 2 / Ubuntu
sudo yum install -y amazon-cloudwatch-agent  # Amazon Linux
# or
sudo apt-get install -y amazon-cloudwatch-agent  # Ubuntu

# Start with your config
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json
```

### CloudWatch Logs Insights (Query Language)

```sql
-- Find all errors in the last hour
fields @timestamp, @message
| filter @message like /error/i
| sort @timestamp desc
| limit 50

-- Count errors by type
fields @timestamp, @message
| filter level = "error"
| stats count(*) as errorCount by error
| sort errorCount desc

-- P95 response time
fields @timestamp, responseTime
| stats percentile(responseTime, 95) as p95 by bin(5m)

-- Find slow requests
fields @timestamp, @message, responseTime
| filter responseTime > 2000
| sort responseTime desc
| limit 20
```

### Retention Policies and Cost

| Retention | Cost Impact | Use Case |
|-----------|-------------|----------|
| 1 day | Lowest | High-volume debug logs |
| 7 days | Low | Development environments |
| 30 days | Medium | Standard production |
| 90 days | Higher | Compliance requirements |
| Never expire | Highest | Audit/legal (archive to S3 instead!) |

**Cost tip:** Export older logs to S3 (much cheaper storage) and query with Athena when needed.

---

## 09 — CloudWatch Dashboards

### Building a Team Dashboard

A good production dashboard answers at a glance: "Is everything healthy?"

### Key Metrics to Display

```
┌─────────────────────────────────────────────────────────────────┐
│  Production Dashboard                                           │
├─────────────────────┬─────────────────────┬─────────────────────┤
│  Request Rate       │  Error Rate (%)     │  P95 Response Time  │
│  ████████████ 250/s │  ██ 0.3%            │  ████ 180ms         │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  CPU Utilization    │  Memory Usage       │  Active DB Conns    │
│  ██████ 45%         │  ████████ 62%       │  ████ 34/100        │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  Disk Space         │  ALB Healthy Hosts  │  Monthly Cost       │
│  ██████████ 78%     │  🟢 4/4             │  $342 (↑3%)         │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

### The Golden Signals (Google SRE)

| Signal | What It Measures | CloudWatch Metric |
|--------|-----------------|-------------------|
| **Latency** | How long requests take | ALB `TargetResponseTime` |
| **Traffic** | How much demand is hitting your system | ALB `RequestCount` |
| **Errors** | Rate of failed requests | ALB `HTTPCode_Target_5XX_Count` |
| **Saturation** | How full your service is | EC2 `CPUUtilization`, RDS `DatabaseConnections` |

> If you can only monitor four things, monitor these four.

---

## 10 — Alerting Strategy

### The Cardinal Sin: Alert Fatigue

```
Day 1:   "CPU at 82%!" → Team investigates immediately
Day 7:   "CPU at 82%!" → Team checks, it's fine
Day 30:  "CPU at 82%!" → Team ignores
Day 60:  "Database is down!" → Team ignores (thinks it's another CPU alert)
Day 60:  Customers: "SITE IS DOWN" → Team panics
```

**Alert fatigue kills.** Every alert must be actionable.

### Alert Design Principles

| ✅ Good Alert | ❌ Bad Alert |
|--------------|-------------|
| Symptom-based ("error rate > 5%") | Cause-based ("CPU > 80%") |
| Actionable (clear what to do) | Informational (no action needed) |
| Rare enough to take seriously | Fires daily (becomes noise) |
| Has a runbook link | No context |
| Auto-resolves when fixed | Requires manual clearing |

### Severity Levels

| Severity | Response | Example | Notification |
|----------|----------|---------|-------------|
| 🔴 P1 — Critical | Wake up, fix NOW | Site down, data loss | PagerDuty phone call |
| 🟠 P2 — High | Fix within 1 hour | Error rate elevated, degraded perf | Slack + SMS |
| 🟡 P3 — Medium | Fix within business hours | Disk space at 75%, non-critical service degraded | Slack only |
| 🟢 P4 — Low | Fix when convenient | Certificate expiring in 30 days | Email / ticket |

### Runbooks

Every P1/P2 alert should link to a runbook:

```markdown
## Alert: HighErrorRate-Production

### Symptoms
- 5XX error rate exceeded 5% for 3 minutes

### Likely Causes
1. Bad deployment (check: was there a deploy in last 30 min?)
2. Database overloaded (check: RDS CPU and connections)
3. Downstream service failure (check: dependency health)

### Immediate Actions
1. Check recent deploys: `git log --oneline -5`
2. If bad deploy → rollback: `./scripts/rollback.sh`
3. Check RDS: CloudWatch → RDS → CPU & Connections
4. Check dependencies: run `/health` on each service

### Escalation
If not resolved in 15 minutes → page on-call lead
```

---

## 11 — Backups

### The Untested Backup Doesn't Exist

> "Everyone has a backup strategy. Very few have a **restore** strategy."

### RDS Automated Backups

```
┌─────────────────────────────────────────────┐
│  RDS Backup Strategy                        │
│                                             │
│  Automated Backups:                         │
│  ├── Daily full snapshot (during window)    │
│  ├── Transaction logs every 5 minutes       │
│  ├── Retention: 1-35 days (set to 7+)      │
│  └── Point-in-time recovery to any second!  │
│                                             │
│  Manual Snapshots:                          │
│  ├── Before major changes                   │
│  ├── Before migrations                      │
│  ├── Retained until you delete them         │
│  └── Can be shared cross-account            │
└─────────────────────────────────────────────┘
```

```bash
# Create a manual snapshot before migration
aws rds create-db-snapshot \
  --db-instance-identifier production-db \
  --db-snapshot-identifier pre-migration-2024-01-15

# Restore to a point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier production-db \
  --target-db-instance-identifier recovery-db \
  --restore-time "2024-01-15T10:30:00Z"
```

### EC2 / EBS Snapshots

```bash
# Snapshot an EBS volume
aws ec2 create-snapshot \
  --volume-id vol-0abc123 \
  --description "Production data - pre-update"

# Create an AMI (full machine image)
aws ec2 create-image \
  --instance-id i-0abc123 \
  --name "production-app-2024-01-15" \
  --description "Before Node.js upgrade"
```

### Cross-Region Backups

```bash
# Copy snapshot to another region (disaster recovery)
aws ec2 copy-snapshot \
  --source-region us-east-1 \
  --source-snapshot-id snap-abc123 \
  --destination-region eu-west-1 \
  --description "DR copy"
```

### Backup Testing Schedule

| Frequency | What to Test | How |
|-----------|-------------|-----|
| Monthly | RDS point-in-time restore | Restore to new instance, verify data |
| Monthly | AMI launch | Launch instance from AMI, verify app starts |
| Quarterly | Full disaster recovery | Restore entire stack in different region |
| After changes | Sanity check | Snapshot, modify, restore, compare |

---

## 12 — Patching and Security Updates

### The Shared Responsibility Model (Patching)

| Layer | Who Patches | How |
|-------|------------|-----|
| Physical hardware | AWS | Transparent to you |
| Hypervisor | AWS | Transparent to you |
| RDS engine (MySQL/Postgres) | AWS | During maintenance window |
| EC2 Operating System | **YOU** | Manual or SSM Patch Manager |
| Application dependencies | **YOU** | npm audit, pip audit, Dependabot |
| Application code | **YOU** | Your CI/CD pipeline |

### EC2 Patching Strategy

```bash
# Manual approach (simple, for small fleets)
sudo apt update && sudo apt upgrade -y  # Ubuntu/Debian
sudo yum update -y                       # Amazon Linux

# Schedule via cron (not recommended for production)
# Better: Use SSM Patch Manager for compliance-tracked patching
```

### SSM Patch Manager (Proper Approach)

```bash
# Define a patch baseline (what to patch)
aws ssm create-patch-baseline \
  --name "Production-Linux-Baseline" \
  --operating-system "AMAZON_LINUX_2" \
  --approval-rules '{
    "PatchRules": [{
      "PatchFilterGroup": {
        "PatchFilters": [
          {"Key": "CLASSIFICATION", "Values": ["Security"]},
          {"Key": "SEVERITY", "Values": ["Critical", "Important"]}
        ]
      },
      "ApproveAfterDays": 7
    }]
  }'
```

### Maintenance Windows

```
Production patching strategy:
1. Patch staging first (Wednesday 2am)
2. Monitor staging for 48 hours
3. Patch production (Friday 2am) — low-traffic window
4. Have rollback plan ready (AMI from before patching)
```

### RDS Maintenance

RDS handles engine patches, but you control **when**:

```bash
# Set preferred maintenance window
aws rds modify-db-instance \
  --db-instance-identifier production-db \
  --preferred-maintenance-window "sun:03:00-sun:04:00"
```

---

## 13 — Health Checks

### Application Health Endpoint

Every production application needs a `/health` endpoint:

```javascript
// Express.js health check
app.get('/health', async (req, res) => {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  // Database connectivity
  try {
    await db.query('SELECT 1');
    checks.checks.database = { status: 'healthy' };
  } catch (err) {
    checks.checks.database = { status: 'unhealthy', error: err.message };
    checks.status = 'unhealthy';
  }

  // Redis connectivity
  try {
    await redis.ping();
    checks.checks.redis = { status: 'healthy' };
  } catch (err) {
    checks.checks.redis = { status: 'unhealthy', error: err.message };
    checks.status = 'unhealthy';
  }

  // Disk space
  const diskUsage = await checkDiskSpace('/');
  if (diskUsage.percentUsed > 90) {
    checks.checks.disk = { status: 'warning', usage: `${diskUsage.percentUsed}%` };
  } else {
    checks.checks.disk = { status: 'healthy', usage: `${diskUsage.percentUsed}%` };
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(checks);
});

// Readiness check (for load balancers)
app.get('/ready', (req, res) => {
  if (appIsReady) {
    res.status(200).send('OK');
  } else {
    res.status(503).send('Not ready');
  }
});
```

### Health Check Integration Points

| Service | Health Check Used For | Failure Action |
|---------|---------------------|----------------|
| ALB | Route traffic only to healthy instances | Remove from target group |
| Route 53 | DNS failover | Switch to standby |
| Auto Scaling | Replace unhealthy instances | Terminate + launch new |
| ECS | Container health | Restart task |

### ALB Health Check Configuration

```bash
aws elbv2 modify-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --health-check-path "/health" \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3
```

---

## 14 — Incident Response

### When Things Break

```
┌─────────────────────────────────────────────────────────┐
│  Incident Timeline                                      │
│                                                         │
│  T+0    Alert fires                                     │
│  T+2m   On-call acknowledges                            │
│  T+5m   Initial assessment (scope, severity)            │
│  T+10m  Communication: status page updated              │
│  T+15m  Mitigation attempt #1 (rollback/restart)        │
│  T+30m  If not resolved → escalate + war room           │
│  T+??   Resolution                                      │
│  T+1d   Post-mortem (blameless!)                        │
└─────────────────────────────────────────────────────────┘
```

### Rollback Strategies

| Strategy | Speed | Risk | Use When |
|----------|-------|------|----------|
| Code revert (git revert + deploy) | 5-15min | Low | Bad code change |
| AMI rollback (launch previous AMI) | 5-10min | Low | Bad system change |
| Database restore (point-in-time) | 15-60min | Medium | Data corruption |
| Blue-green switch | Instant | Very Low | If you have blue-green |
| Feature flag toggle | Instant | Very Low | If feature flagged |

### Post-Mortem Template

```markdown
## Incident: [Title]
**Date:** 2024-01-15
**Duration:** 45 minutes
**Severity:** P1
**Impact:** 2,000 users saw 500 errors

### Timeline
- 14:30 — Deploy pushed to production
- 14:32 — Error rate alarm fires
- 14:35 — On-call acknowledges
- 14:40 — Identified: new endpoint missing DB index
- 14:45 — Rollback initiated
- 14:50 — Rollback complete, errors resolved
- 15:15 — All clear, monitoring confirmed

### Root Cause
New API endpoint performed a full table scan. Query worked in staging
(1K rows) but timed out in production (2M rows).

### Action Items
- [ ] Add index for the new query pattern
- [ ] Add query performance tests to CI
- [ ] Add response time alarm for new endpoints
- [ ] Review staging data volume (should mirror production)

### Lessons Learned
- Staging data volume was too small to catch perf issues
- Need to run load tests against production-like data before deploy
```

---

## 15 — "What Would Go Wrong If..." Scenarios

### No Billing Alarm

```
Month 1: Normal usage, $50
Month 2: Left a GPU instance running, didn't notice
Month 3: AWS bill arrives: $2,800
Month 4: Still running — $5,600 total
You: "I thought I was on free tier..."
```

**Fix:** Create billing alarms at $10, $50, $100, $500.

### No Disk Space Monitoring

```
Day 1:   App running fine
Day 30:  Logs filling disk slowly (4.7GB/day)
Day 45:  Disk at 95% — no alert
Day 47:  Disk full — app can't write logs OR data
         - Database transactions fail
         - App returns 500 errors
         - Users see "Something went wrong"
         - No logs to debug because disk is full 🤦
```

**Fix:** CloudWatch Agent monitoring disk_used_percent, alarm at 80%.

### Logging PII

```
Developer logs: logger.info('User registered', { user: userObject });
userObject contains: name, email, phone, address, SSN

Result:
- All PII now in CloudWatch Logs, retained for 30 days
- Log Insights queries by anyone with CloudWatch access expose it
- GDPR Article 5: "adequate, relevant, and limited to what is necessary"
- Potential fine: up to €20M or 4% annual global turnover
- Required: purge from all log stores, notify affected users
```

**Fix:** Log only user IDs. Never log raw user objects.

### Alert Fatigue

```
Week 1:  "CPU > 80%" fires 3x — team investigates each time
Week 2:  "CPU > 80%" fires 7x — team acknowledges faster
Week 4:  "CPU > 80%" fires daily — team stops looking
Week 8:  "DATABASE DOWN" alert — team ignores (thinks it's CPU)
Week 8:  Real outage, 2 hours before anyone notices
```

**Fix:** Tune thresholds. Remove noisy alerts. Use composite alarms. Alert on symptoms not causes.

---

## 16 — Tech Lead Decision: Choosing the Observability Stack

### CloudWatch vs Datadog vs Prometheus/Grafana

| Factor | CloudWatch | Datadog | Prometheus + Grafana |
|--------|-----------|---------|---------------------|
| **Setup** | 🟢 Zero for AWS services | 🟡 Agent install + API key | 🔴 Self-hosted infra |
| **Cost** | 🟡 Pay per metric/alarm/log | 🔴 Expensive at scale | 🟢 Free (your infra costs) |
| **AWS integration** | 🟢 Native, automatic | 🟢 Excellent | 🟡 Manual setup |
| **Custom metrics** | 🟡 Good | 🟢 Excellent | 🟢 Excellent |
| **Dashboards** | 🟡 Basic | 🟢 Beautiful | 🟢 Very flexible |
| **Alerting** | 🟡 Functional | 🟢 Advanced | 🟢 AlertManager |
| **APM / Traces** | 🟡 X-Ray (separate) | 🟢 Built-in | 🟡 Need Jaeger/Zipkin |
| **Log management** | 🟡 Logs Insights | 🟢 Full-text search | 🟡 Need Loki |
| **Learning curve** | 🟢 Low | 🟢 Low | 🟡 Medium |
| **Vendor lock-in** | 🟡 AWS-specific | 🔴 Datadog-specific | 🟢 Open source |

### Recommendation by Team Size

| Team / Stage | Recommendation | Why |
|--------------|---------------|-----|
| Solo / startup (< 5 devs) | CloudWatch | Free tier, zero setup, good enough |
| Growth stage (5-30 devs) | Datadog | Better DX, worth the cost, unified platform |
| Scale / budget-constrained | Prometheus + Grafana | Free, flexible, no per-host pricing |
| Enterprise | Mix | CloudWatch for AWS, Datadog for APM, or full Prometheus |

---

## 17 — Complete Winston + CloudWatch Setup

```javascript
// logger.js — Production logging configuration
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'my-app',
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION || 'unknown'
  },
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
    })
  ]
});

// In production, also send to CloudWatch directly (alternative to agent)
if (isProduction) {
  logger.add(new WinstonCloudWatch({
    logGroupName: `/app/${process.env.SERVICE_NAME}/production`,
    logStreamName: `${process.env.HOSTNAME || 'unknown'}-${Date.now()}`,
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    jsonMessage: true,
    retentionInDays: 30
  }));
}

module.exports = logger;
```

```javascript
// Usage in Express middleware
const logger = require('./logger');

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      requestId: req.headers['x-request-id']
    });
  });
  next();
});
```

---

## 18 — Summary

| Topic | Key Takeaway |
|-------|-------------|
| Metrics | Numbers over time — CPU, errors, latency |
| Logs | Event records — structured JSON, never PII |
| Alarms | Threshold → Action. Alert on symptoms, not causes |
| Billing | First alarm. Non-negotiable. |
| Dashboards | Golden Signals: latency, traffic, errors, saturation |
| Alerting | Actionable or don't alert. Fatigue kills. |
| Backups | Untested = nonexistent. Monthly restore drills. |
| Patching | EC2 = your job. RDS = AWS's job (you control when). |
| Health checks | `/health` + `/ready`. Integrated with ALB/ASG. |
| Incidents | Timeline, rollback, blameless post-mortem |

> **Interview Callout:** "Design a monitoring strategy for a production web application. What metrics would you track and what alerts would you set?"
>
> **Strong answer structure:** Start with the Golden Signals (latency, traffic, errors, saturation). Layer in: billing alarms, disk/memory (CloudWatch Agent), application-specific metrics (orders/min, payment success rate). Alert on symptoms ("error rate > 5% for 3min") not causes ("CPU > 80%"). Dashboard for the team. Runbooks for every P1/P2. Post-mortem process for learning.

---

## 19 — Quick Reference

### Essential CloudWatch CLI Commands

```bash
# List available metrics for EC2
aws cloudwatch list-metrics --namespace AWS/EC2

# Get current CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-0abc123 \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average

# Query logs
aws logs start-query \
  --log-group-name "/app/production" \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter level = "error" | limit 20'

# Describe alarms in ALARM state
aws cloudwatch describe-alarms --state-value ALARM
```
