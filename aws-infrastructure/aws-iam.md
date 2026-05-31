---
title: "AWS IAM — Identity, Roles, Policies, and the Principle of Least Privilege"
description: "Master IAM users, groups, roles, policies, and instance profiles — the authorization layer that governs who can do what within AWS itself."
order: 10
---

# AWS IAM — Identity, Roles, Policies, and the Principle of Least Privilege

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate-Advanced · **Related:** IAM · Roles · Policies · Least Privilege · Instance Profiles

---

## 01 — TL;DR

- **IAM** is AWS's permission system — it controls who (people and services) can do what to which AWS resources
- **Users** are for humans, **Roles** are for services — never hardcode credentials
- **Policies** are JSON documents that define allow/deny rules; explicit deny always wins
- **Instance Profiles** let EC2 instances assume roles — the SDK auto-discovers credentials from the metadata service
- **Principle of Least Privilege** — start with zero permissions, add only what's needed, review regularly
- **Cross-account access** uses trust relationships and `sts:AssumeRole` — no credential sharing required
- **SCPs** are organization-level guardrails that restrict what member accounts can do, even with admin policies

**Why this matters:** IAM is the security foundation of every AWS deployment. A misconfigured policy can expose your entire infrastructure. Every interview involving AWS will test your IAM understanding — it's not optional knowledge, it's table stakes.

---

## 02 — What Is IAM?

IAM (Identity and Access Management) is AWS's permission system. It answers three questions:

1. **Who are you?** (Authentication — proving your identity)
2. **What can you do?** (Authorization — what actions are permitted)
3. **On what resources?** (Scope — which specific AWS resources)

### The Critical Distinction

| Concept | What It Means | Example |
|---------|---------------|---------|
| **App Auth** | Your application's users | "Can user@gmail.com view their own orders?" |
| **IAM Auth** | Your team + AWS services | "Can the backend EC2 instance read from the secrets store?" |

These are completely separate systems. Your React app's login has nothing to do with IAM. IAM governs the infrastructure layer — who on your team can deploy, which services can talk to which other services, and what permissions your CI/CD pipeline has.

### Analogy

Think of IAM like a building's access control system:
- **Users** = employee badges
- **Groups** = departments (Engineering, Finance)
- **Roles** = temporary visitor passes (you put them on, do your thing, hand them back)
- **Policies** = the rules programmed into the badge readers ("Engineering can access floors 3-5, Lab only during business hours")

---

## 03 — The Root Account

The root account is the account you created when you first signed up for AWS. It has **unrestricted access to everything** — billing, account closure, service quotas, everything.

### Why You Should Never Use It Daily

```
Root Account = God Mode = Maximum Blast Radius
```

If root credentials are compromised, an attacker can:
- Spin up thousands of expensive instances (crypto mining)
- Delete all your data
- Lock you out of your own account
- Access billing information and credit cards

### What Root Should Be Used For (and ONLY these)

| ✅ Acceptable Root Use | ❌ Never Do This |
|------------------------|------------------|
| Initial IAM admin user creation | Daily development work |
| Account-level settings | Deploying applications |
| Billing configuration | Running scripts |
| Closing the account | Creating S3 buckets |
| Changing the root email | Any routine operation |

### Day-One Root Lockdown Checklist

```bash
# 1. Enable MFA on root (use a hardware key if possible)
# 2. Create an IAM admin user
# 3. Create a strong, unique root password
# 4. Store root credentials in a physical safe or password manager
# 5. Never generate access keys for root
# 6. Set up billing alerts
```

> **Interview Callout:** "What's the first thing you do after creating a new AWS account?" → "Enable MFA on root, then create an IAM admin user and stop using root immediately."

---

## 04 — IAM Users

An IAM user represents a single identity — typically a human team member or a service account.

### Two Types of Access

| Access Type | Credentials | Use Case |
|-------------|-------------|----------|
| **Console Access** | Username + Password + (MFA) | Humans logging into the AWS web UI |
| **Programmatic Access** | Access Key ID + Secret Access Key | Scripts, CLI, CI/CD pipelines |

### Access Key Anatomy

```
Access Key ID:     AKIAIOSFODNN7EXAMPLE     (20 chars, starts with AKIA)
Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY  (40 chars)
```

### Why Access Keys Are Dangerous

Access keys are **permanent credentials** (until rotated). If leaked:

```bash
# If someone gets your access key, they can do this:
aws s3 ls                          # List all your buckets
aws ec2 describe-instances         # See all your servers
aws s3 rm s3://your-bucket --recursive  # Delete everything
```

**Real-world horror stories:**
- Developer commits `.env` with access keys to public GitHub repo
- AWS key scanners (automated bots) detect it within **minutes**
- Attacker spins up 200 GPU instances for crypto mining
- Developer gets a $50,000+ bill

### Best Practice: Minimize IAM Users

```
Modern approach:
- Use IAM Identity Center (SSO) for human access
- Use IAM Roles for service access
- IAM Users with access keys = last resort
```

---

## 05 — IAM Groups

Groups are logical containers for IAM users. They exist for one reason: **to simplify permission management at scale**.

### The Pattern

```
                    ┌─────────────┐
                    │  Developers │ ← Policy: ReadWrite to dev resources
                    │  Group      │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────┴───┐  ┌────┴───┐  ┌────┴───┐
         │ Alice  │  │  Bob   │  │ Carol  │
         └────────┘  └────────┘  └────────┘
```

### Rules

- Users can belong to multiple groups
- Groups cannot be nested (no groups within groups)
- Policies attached to the group apply to ALL members
- **Always attach policies to groups, never directly to users**

### Example Group Structure

| Group | Policy | Members |
|-------|--------|---------|
| `Developers` | ReadWrite to dev S3, RDS, EC2 | Alice, Bob, Carol |
| `DevOps` | Full EC2, ECS, CloudWatch; deploy permissions | Dave, Eve |
| `Managers` | ReadOnly to everything + billing access | Frank, Grace |
| `ReadOnly` | ViewOnly across all services | All members (secondary group) |

### Why Groups Over Direct User Policies?

```
Without groups (nightmare at scale):
- 20 developers × 5 policy changes = 100 manual updates

With groups (sane):
- 1 group policy change = all 20 developers updated instantly
```

---

## 06 — IAM Policies (Deep Dive)

Policies are JSON documents that define permissions. They are the core of IAM — everything else is just a way to attach policies to identities.

### Policy Structure

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-app-bucket",
        "arn:aws:s3:::my-app-bucket/*"
      ],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "10.0.0.0/8"
        }
      }
    }
  ]
}
```

### Anatomy Breakdown

| Field | Purpose | Example |
|-------|---------|---------|
| `Version` | Policy language version (always use this) | `"2012-10-17"` |
| `Statement` | Array of permission rules | [...] |
| `Sid` | Optional human-readable ID | `"AllowS3ReadOnly"` |
| `Effect` | Allow or Deny | `"Allow"` or `"Deny"` |
| `Action` | API calls permitted/denied | `"s3:GetObject"` |
| `Resource` | Which AWS resources (ARN) | `"arn:aws:s3:::bucket/*"` |
| `Condition` | Optional restrictions | IP, MFA, time, tags |

### Three Policy Types

| Type | Managed By | Reusable? | Use Case |
|------|-----------|-----------|----------|
| **AWS Managed** | AWS | ✅ Yes | Quick start (`AmazonS3ReadOnlyAccess`) |
| **Customer Managed** | You | ✅ Yes | Your team's specific permissions |
| **Inline** | Attached to one entity | ❌ No | Rare one-off exceptions |

### Policy Evaluation Logic

```
                    ┌──────────────────┐
                    │ Request received │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Explicit DENY     │──── YES ──→ ❌ DENIED
                    │ anywhere?         │
                    └────────┬─────────┘
                             │ NO
                    ┌────────▼─────────┐
                    │ Explicit ALLOW    │──── NO ──→ ❌ DENIED (implicit deny)
                    │ found?            │
                    └────────┬─────────┘
                             │ YES
                    ┌────────▼─────────┐
                    │  ✅ ALLOWED       │
                    └──────────────────┘
```

**The Golden Rule: Explicit deny ALWAYS wins.** Even if you have `AdministratorAccess`, a single deny statement will block that action.

### Example: Bad vs Good Policy

**❌ Overly Permissive (Bad)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
```

Why it's bad: Allows ALL S3 actions on ALL buckets — including deleting production data, making buckets public, accessing other teams' data.

**✅ Properly Scoped (Good)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAppBucketReadWrite",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::my-app-uploads/*"
    },
    {
      "Sid": "AllowListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-app-uploads",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["uploads/*", "temp/*"]
        }
      }
    }
  ]
}
```

Why it's good: Only allows specific actions, on one specific bucket, with prefix restrictions.

### More Real-World Policy Examples

**Secrets Manager — App can only read its own secrets:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:myapp/*"
    }
  ]
}
```

**RDS — Developers can view but not modify production DB:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds:Describe*",
        "rds:ListTagsForResource"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Action": [
        "rds:DeleteDBInstance",
        "rds:ModifyDBInstance",
        "rds:RebootDBInstance"
      ],
      "Resource": "arn:aws:rds:*:*:db:production-*"
    }
  ]
}
```

---

## 07 — IAM Roles

Roles are the most important IAM concept for production systems. A role is like a temporary "hat" — an identity can assume (put on) a role, gain its permissions, and then release it.

### Key Differences: Users vs Roles

| Feature | IAM User | IAM Role |
|---------|----------|----------|
| Permanent credentials | ✅ Yes (password/keys) | ❌ No |
| Can be assumed by services | ❌ No | ✅ Yes |
| Temporary credentials | ❌ No | ✅ Yes (auto-rotated) |
| Cross-account access | Complex | Simple |
| Best for | Human console access | Services, automation, cross-account |

### Who/What Can Assume a Role?

- **EC2 instances** — "This server can read from S3"
- **Lambda functions** — "This function can write to DynamoDB"
- **ECS tasks** — "This container can access Secrets Manager"
- **Other AWS accounts** — "Account B's dev team can read our logs"
- **Federated users** — "Google Workspace users can access our AWS console"
- **CI/CD pipelines** — "GitHub Actions can deploy to our infrastructure"

### How Role Assumption Works

```
1. Entity requests to assume role (sts:AssumeRole)
2. AWS checks the role's TRUST POLICY (who is allowed to assume it?)
3. If trusted → AWS issues TEMPORARY credentials
4. Credentials have an expiry (default: 1 hour, max: 12 hours)
5. Entity uses temporary credentials for API calls
6. Credentials expire → access revoked automatically
```

### Trust Policy Example

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

This says: "EC2 instances are allowed to assume this role."

---

## 08 — Instance Profiles

Instance Profiles are the mechanism that connects IAM roles to EC2 instances. When you "attach a role to an EC2 instance," you're actually using an instance profile.

### How It Works

```
┌─────────────────────────────────────────────┐
│  EC2 Instance                               │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Instance Metadata Service          │    │
│  │  http://169.254.169.254             │    │
│  │                                     │    │
│  │  /latest/meta-data/iam/            │    │
│  │  └── security-credentials/         │    │
│  │      └── my-app-role               │    │
│  │          ├── AccessKeyId           │    │
│  │          ├── SecretAccessKey       │    │
│  │          ├── Token                 │    │
│  │          └── Expiration            │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  AWS SDK automatically checks here first!    │
└─────────────────────────────────────────────┘
```

### The Credential Resolution Chain (AWS SDK)

When your app calls an AWS service, the SDK looks for credentials in this order:

```
1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
2. Shared credentials file (~/.aws/credentials)
3. ECS container credentials
4. ★ Instance profile (metadata service) ← THIS IS WHAT YOU WANT
5. SSO credentials
```

### Why This Is Revolutionary

**Without instance profiles (old, dangerous way):**

```bash
# .env file on EC2 (BAD!)
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**With instance profiles (correct way):**

```javascript
// No credentials needed in code!
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'us-east-1' });
// SDK automatically gets credentials from instance profile
const result = await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt'
}));
```

### Benefits

| Feature | Hardcoded Keys | Instance Profile |
|---------|---------------|------------------|
| Auto-rotation | ❌ Manual | ✅ Every few hours |
| Leak risk | 🔴 High (in code/env) | 🟢 Low (never on disk) |
| Multi-instance | ❌ Copy keys everywhere | ✅ Same role, all instances |
| Revocation | ❌ Rotate key + redeploy | ✅ Detach role instantly |
| Audit trail | ⚠️ "Which instance used this key?" | ✅ CloudTrail shows exact instance |

> **Interview Callout:** "How do you give an EC2 instance permission to access S3 without storing credentials on the instance?" → "Attach an IAM role via an instance profile. The AWS SDK automatically retrieves temporary credentials from the instance metadata service."

---

## 09 — Principle of Least Privilege

The golden rule of IAM: **grant only the minimum permissions necessary to perform the required task.** Nothing more, nothing less.

### The Mindset Shift

```
❌ "Give them admin access, they'll figure out what they need"
✅ "What specific actions does this entity need to perform?"
```

### Practical Application

**Step 1: Start with zero permissions**

```json
{
  "Version": "2012-10-17",
  "Statement": []
}
```

**Step 2: Add only what's needed, as needed**

Developer says: "I need to upload images to S3"

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::app-images/uploads/*"
    }
  ]
}
```

Not `s3:*`. Not all buckets. Not even all prefixes. Just PutObject to the specific path.

### Overly Permissive vs Properly Scoped

| Scenario | ❌ Overly Permissive | ✅ Properly Scoped |
|----------|---------------------|-------------------|
| App reads secrets | `secretsmanager:*` on `*` | `secretsmanager:GetSecretValue` on `arn:.../myapp/*` |
| CI/CD deploys | `AdministratorAccess` | Specific deploy actions on specific resources |
| Lambda writes logs | `logs:*` | `logs:CreateLogGroup`, `logs:PutLogEvents` on its own log group |
| Dev accesses staging DB | `rds:*` | `rds:Connect` on staging DB only |

### IAM Access Analyzer

AWS provides a tool to find unused permissions:

```bash
# Generate a policy based on actual CloudTrail activity
aws accessanalyzer generate-policy --principal-arn arn:aws:iam::123456789012:role/MyRole

# List findings (external access, unused access)
aws accessanalyzer list-findings --analyzer-arn <analyzer-arn>
```

Access Analyzer reviews CloudTrail logs and tells you:
- "This role has 50 permissions but only used 8 in the last 90 days"
- "These resources are accessible from outside your account"

---

## 10 — Policy Conditions

Conditions add powerful constraints beyond just Action + Resource. They answer: "Under what circumstances is this permission valid?"

### Common Condition Types

```json
{
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": ["10.0.0.0/8", "192.168.1.0/24"]
    }
  }
}
```

### Practical Condition Examples

**Require MFA for destructive actions:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAllButDenyDangerousWithoutMFA",
      "Effect": "Deny",
      "Action": [
        "ec2:TerminateInstances",
        "rds:DeleteDBInstance",
        "s3:DeleteBucket"
      ],
      "Resource": "*",
      "Condition": {
        "BoolIfExists": {
          "aws:MultiFactorAuthPresent": "false"
        }
      }
    }
  ]
}
```

**Time-based access (contractors work business hours only):**

```json
{
  "Condition": {
    "DateGreaterThan": {"aws:CurrentTime": "2024-01-01T09:00:00Z"},
    "DateLessThan": {"aws:CurrentTime": "2024-01-01T18:00:00Z"}
  }
}
```

**Tag-based access (teams can only manage their own resources):**

```json
{
  "Condition": {
    "StringEquals": {
      "aws:ResourceTag/Team": "${aws:PrincipalTag/Team}"
    }
  }
}
```

This means: "You can only access resources tagged with your own team name."

### Condition Operators

| Operator | Use For | Example |
|----------|---------|---------|
| `StringEquals` | Exact match | Tag values |
| `StringLike` | Wildcard match | `"s3:prefix": "uploads/*"` |
| `IpAddress` | CIDR range | Office IP restriction |
| `DateLessThan` | Time bounds | Temporary access |
| `Bool` | True/false | MFA present |
| `ArnLike` | ARN patterns | Cross-account |

---

## 11 — Cross-Account Access

In real organizations, you have multiple AWS accounts (dev, staging, production, security, billing). Cross-account access lets you manage this without duplicating users or sharing credentials.

### The Pattern

```
┌──────────────────┐         ┌──────────────────┐
│  Account A       │         │  Account B       │
│  (Development)   │         │  (Production)    │
│                  │         │                  │
│  Dev Team Users  │──assume──▶ ReadOnlyLogsRole│
│                  │         │                  │
└──────────────────┘         └──────────────────┘
```

### Step-by-Step Setup

**In Account B (Production) — Create the role:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "Bool": {
          "aws:MultiFactorAuthPresent": "true"
        }
      }
    }
  ]
}
```

**In Account A (Development) — Allow users to assume the role:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::222222222222:role/ReadOnlyLogsRole"
    }
  ]
}
```

**Using it:**

```bash
# Assume the role
aws sts assume-role \
  --role-arn arn:aws:iam::222222222222:role/ReadOnlyLogsRole \
  --role-session-name "debug-session-alice"

# Returns temporary credentials (valid for 1 hour)
{
  "AccessKeyId": "ASIA...",
  "SecretAccessKey": "...",
  "SessionToken": "...",
  "Expiration": "2024-01-15T10:00:00Z"
}
```

### Real Use Case: Dev Team Accessing Production Logs

The dev team needs to debug a production issue but should NOT be able to modify production resources:

- **Role permissions:** CloudWatch Logs read-only
- **Trust policy:** Only Account A users with MFA
- **Benefit:** No production credentials stored in dev account, access is auditable, temporary, and revocable

---

## 12 — Service Control Policies (SCPs)

SCPs are organization-level guardrails that restrict what member accounts can do. They set the **maximum possible permissions** for an account.

### How SCPs Work

```
┌─────────────────────────────────────────────┐
│  AWS Organization                           │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  SCP: "No resources outside          │    │
│  │        us-east-1 and eu-west-1"      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Even if an IAM policy says "Allow *"       │
│  the SCP blocks it.                         │
│                                             │
│  SCP = ceiling, IAM policy = actual perms   │
└─────────────────────────────────────────────┘
```

### Key Points

- SCPs **don't grant** permissions — they only restrict
- They apply to **all users and roles** in the account (including admin)
- They do NOT affect the management account (root org account)
- An action must be allowed by BOTH the SCP and the IAM policy

### Example: Region Restriction

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["us-east-1", "eu-west-1"]
        }
      }
    }
  ]
}
```

### Example: Prevent Leaving the Organization

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "organizations:LeaveOrganization",
      "Resource": "*"
    }
  ]
}
```

---

## 13 — IAM Best Practices Checklist

The security checklist every tech lead enforces:

| # | Practice | Priority |
|---|----------|----------|
| 1 | Enable MFA on root account | 🔴 Critical |
| 2 | Never use root for daily operations | 🔴 Critical |
| 3 | Never generate root access keys | 🔴 Critical |
| 4 | Use roles for applications (not users with keys) | 🔴 Critical |
| 5 | Apply least privilege | 🔴 Critical |
| 6 | Use groups to assign permissions | 🟡 Important |
| 7 | Rotate credentials regularly | 🟡 Important |
| 8 | Use policy conditions for extra security | 🟡 Important |
| 9 | Monitor with CloudTrail | 🟡 Important |
| 10 | Run IAM Access Analyzer regularly | 🟡 Important |
| 11 | Use SCPs for organization guardrails | 🟢 Recommended |
| 12 | Implement permission boundaries | 🟢 Recommended |
| 13 | Tag all IAM resources | 🟢 Recommended |
| 14 | Regular access reviews (quarterly) | 🟢 Recommended |

---

## 14 — "What Would Go Wrong If..." Scenarios

### Scenario 1: Access Key Committed to GitHub

```
Timeline:
T+0min  — Developer pushes .env with AWS keys to public repo
T+2min  — Automated bots (aws-key-scanner) detect the key
T+5min  — Attacker starts spinning up c5.18xlarge instances
T+1hr   — 200 instances mining cryptocurrency
T+24hr  — AWS bill: $12,000 and climbing
T+48hr  — Developer gets email from AWS abuse team
```

**Prevention:** Instance profiles. No access keys. If keys are necessary, use AWS Secrets Manager + rotation.

### Scenario 2: EC2 with AdministratorAccess Role

```
Risk: If the EC2 instance is compromised (e.g., through an SSRF vulnerability),
the attacker can:
- Read all secrets in the account
- Launch more instances
- Modify security groups
- Access all S3 data
- Create new IAM users with permanent access
```

**Prevention:** Scope the role to ONLY what the application needs. A web server typically needs: S3 (specific bucket), Secrets Manager (its secrets), CloudWatch (its logs).

### Scenario 3: No MFA on Root

```
Risk: If root password is compromised (phishing, reuse from another breach):
- Attacker has FULL account control
- Can delete all IAM users (locking out your team)
- Can close the account
- Can access billing and change payment methods
- SCPs don't apply to management account root
```

### Scenario 4: Wildcard Permissions (`*` on Resource)

```json
{"Effect": "Allow", "Action": "s3:*", "Resource": "*"}
```

```
Risk:
- User can read OTHER teams' buckets (data breach)
- User can delete production buckets
- User can make buckets public
- User can access cross-account buckets if bucket policy allows
- Violates any compliance framework (SOC2, HIPAA, PCI-DSS)
```

---

## 15 — Tech Lead Decision: Roles vs Users for CI/CD

### The Question

"Should our CI/CD pipeline (GitHub Actions, Jenkins, GitLab CI) use an IAM user with access keys or an IAM role?"

### Decision Matrix

| Factor | IAM User (Access Keys) | IAM Role (OIDC Federation) |
|--------|----------------------|---------------------------|
| Setup complexity | 🟢 Simple | 🟡 Moderate |
| Security | 🔴 Keys can leak | 🟢 No permanent credentials |
| Rotation needed | ✅ Yes (manual) | ❌ No (automatic) |
| Audit clarity | ⚠️ "Which pipeline used this key?" | ✅ "This specific workflow run" |
| Cross-account | ⚠️ Key per account | ✅ Assume roles |
| AWS recommendation | ❌ Legacy approach | ✅ Recommended |

### The Answer: Use OIDC Federation with Roles

```yaml
# GitHub Actions — no access keys needed!
jobs:
  deploy:
    permissions:
      id-token: write  # Required for OIDC
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubDeployRole
          aws-region: us-east-1
```

GitHub Actions gets temporary credentials by proving its identity to AWS via OIDC. No keys stored anywhere.

---

## 16 — Interview Design Question

> **"How would you design IAM policies for a team of 20 developers, 3 DevOps engineers, and 2 managers?"**

### Structured Answer

**1. Account Structure:**
- Separate AWS accounts for dev, staging, production (AWS Organizations)
- SCP restricting all accounts to approved regions only

**2. Group-Based Permissions:**

| Group | Members | Permissions |
|-------|---------|-------------|
| `Developers` | 20 devs | Full access to dev account; read-only to staging; no production access |
| `DevOps` | 3 engineers | Full access to dev/staging; deploy-only in production (via CI/CD roles); CloudWatch/logs in production |
| `Managers` | 2 managers | Read-only everywhere; billing access; cost explorer |
| `Everyone` | All 25 | MFA required; no root usage; CloudWatch dashboards |

**3. Service Roles:**
- `AppServerRole` — EC2 instances: S3 uploads bucket, Secrets Manager app secrets, CloudWatch logs
- `CICDDeployRole` — GitHub Actions: ECS deploy, ECR push, S3 artifact upload
- `LambdaExecRole` — Lambda functions: specific DynamoDB table, SQS queue

**4. Guardrails:**
- SCP: no resources outside us-east-1/eu-west-1
- SCP: cannot delete CloudTrail
- Permission boundary on all developer-created roles (can't escalate)
- MFA required for any production access

**5. Monitoring:**
- CloudTrail enabled in all accounts
- IAM Access Analyzer running weekly
- Quarterly access review (remove unused permissions)

---

## 17 — Policy Evaluation Flowchart (Complete)

```
Request: "Can Principal X perform Action Y on Resource Z?"

Step 1: Organization SCPs
├── Any SCP denies it? → ❌ DENIED
└── All SCPs allow (or no SCP applies)?
    │
    ▼
Step 2: Resource-based policies (S3 bucket policy, KMS key policy)
├── Explicit deny? → ❌ DENIED
├── Explicit allow? → Note it (may be sufficient for cross-account)
└── Continue...
    │
    ▼
Step 3: Permission boundaries (if set)
├── Does the boundary allow the action? → Continue
└── Boundary doesn't allow → ❌ DENIED
    │
    ▼
Step 4: Identity-based policies (user/group/role policies)
├── Explicit deny? → ❌ DENIED
├── Explicit allow? → ✅ ALLOWED
└── No statement matches → ❌ DENIED (implicit deny)
```

### Key Takeaways

1. **Deny always wins** over allow at any level
2. **SCP is evaluated first** — it's the ceiling
3. **Permission boundaries** limit what identity policies can grant
4. **No statement = implicit deny** — you must explicitly allow
5. **Cross-account** requires BOTH sides to allow (resource policy + identity policy)

---

## 18 — Quick Reference

### Common IAM CLI Commands

```bash
# List all users
aws iam list-users

# List policies attached to a role
aws iam list-attached-role-policies --role-name MyRole

# Simulate a policy (will this action be allowed?)
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:user/Alice \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::my-bucket/file.txt

# Get last-accessed information (for least privilege)
aws iam generate-service-last-accessed-details \
  --arn arn:aws:iam::123456789012:role/MyRole

# Create an instance profile and attach a role
aws iam create-instance-profile --instance-profile-name MyAppProfile
aws iam add-role-to-instance-profile \
  --instance-profile-name MyAppProfile \
  --role-name MyAppRole
```

### ARN Format

```
arn:aws:service:region:account-id:resource-type/resource-id

Examples:
arn:aws:s3:::my-bucket                         (S3 bucket - no region/account for S3)
arn:aws:s3:::my-bucket/*                       (All objects in bucket)
arn:aws:ec2:us-east-1:123456789012:instance/*  (All EC2 instances)
arn:aws:iam::123456789012:role/MyRole          (IAM role - global, no region)
arn:aws:rds:us-east-1:123456789012:db:mydb     (Specific RDS instance)
```

---

## 19 — Summary

| Concept | One-Line Summary |
|---------|-----------------|
| IAM | AWS's who-can-do-what system |
| Root | God mode — lock it, forget it |
| Users | Individual identities (prefer roles) |
| Groups | Logical groupings for policy assignment |
| Policies | JSON rules (effect + action + resource) |
| Roles | Temporary hats — no permanent credentials |
| Instance Profiles | How roles attach to EC2 |
| Least Privilege | Start with zero, add only what's needed |
| Conditions | IP, MFA, time, tag restrictions |
| Cross-Account | Trust policies + sts:AssumeRole |
| SCPs | Organization-level guardrails |

> **The IAM mindset:** "If it doesn't need access, it doesn't get access. If it only needs read, it doesn't get write. If it only needs one bucket, it doesn't get all buckets. If it only needs it temporarily, it gets a role, not a user."
