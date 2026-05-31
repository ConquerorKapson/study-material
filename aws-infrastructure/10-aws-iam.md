---
title: "Phase 10 — AWS IAM"
description: "Identity and Access Management — users, roles, policies. Authorization within AWS itself, separate from your app's auth."
order: 10
---

# Phase 10 — AWS IAM

> **Category:** Security · **Difficulty:** Intermediate → Advanced · **Related:** EC2 · Least Privilege · Security

---

## TLDR

IAM controls who can do what within your AWS account. Users = humans. Roles = services (EC2 assumes a role to access S3). Policies = JSON documents defining permissions. Golden rule: **least privilege** — give minimum permissions needed. Never put AWS keys on EC2; attach an IAM role instead. The instance metadata service provides temporary credentials automatically.

---

## 01 — The Real-World Analogy

| IAM Concept | Company Analogy |
|------------|-----------------|
| Root account | CEO (all-powerful, use rarely) |
| IAM User | Employee with specific badge |
| IAM Group | Department (Engineering, Finance) |
| IAM Role | A hat anyone can wear temporarily (e.g., "deploy hat" gives deploy permissions) |
| IAM Policy | Written rules on what each badge/hat allows |
| MFA | Two-factor badge + PIN to enter |

---

## 02 — IAM Entities

### Root Account

- Created when you make your AWS account
- Full unrestricted access to everything
- **Rules:** Enable MFA. Never use for daily work. Never create access keys for root.

### IAM Users

```
A human or service account with:
- Username
- Password (console access)
- Access keys (API/CLI access)
- Attached policies defining permissions
```

### IAM Groups

```
Groups make policy management scalable:
- Group: "Developers" → Policies: EC2 full, S3 read, RDS read
- Group: "DevOps"     → Policies: Full admin
- Group: "ReadOnly"   → Policies: Read all, write nothing

Add user to group → inherits all group policies
```

### IAM Roles (Critical for EC2)

A role is a set of permissions that can be **assumed** by:
- An EC2 instance (most common)
- A Lambda function
- Another AWS account
- A user temporarily

**No permanent credentials.** The assumer gets temporary credentials that auto-expire and auto-rotate.

---

## 03 — IAM Policies (JSON)

### Structure

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*"
    },
    {
      "Effect": "Deny",
      "Action": "s3:DeleteObject",
      "Resource": "*"
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| Effect | Allow or Deny |
| Action | What API calls (e.g., `s3:GetObject`, `ec2:StartInstances`) |
| Resource | What specific thing (ARN of S3 bucket, EC2 instance, etc.) |
| Condition | Optional: when (IP range, time, MFA present) |

### Policy Types

| Type | Attached to | Example |
|------|-------------|---------|
| **Managed** (AWS) | Users/Groups/Roles | `AmazonS3ReadOnlyAccess` |
| **Managed** (Custom) | Users/Groups/Roles | Your own policies |
| **Inline** | Single user/group/role | One-off specific permissions |
| **Resource-based** | The resource itself | S3 bucket policy |

---

## 04 — IAM Roles for EC2 (The Right Way)

### The WRONG Way (Never Do This)

```bash
# On EC2 — DON'T:
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=wJalr...
# Permanent credentials on disk. If EC2 compromised, keys compromised forever.
```

### The RIGHT Way

```
1. Create IAM Role: "my-app-role"
2. Attach policy: { Allow s3:GetObject on my-bucket }
3. Create Instance Profile (wrapper for role)
4. Attach Instance Profile to EC2

Now on EC2:
- AWS SDK automatically detects the role
- Gets temporary credentials from instance metadata
- Credentials rotate automatically (every ~6 hours)
- If EC2 is compromised: revoke the role, creds expire within minutes
```

### How It Works Under the Hood

```javascript
// Your code — just use the SDK, no credentials needed!
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'ap-south-1' });
// SDK automatically fetches creds from:
// http://169.254.169.254/latest/meta-data/iam/security-credentials/my-app-role

const result = await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.pdf'
}));
```

---

## 05 — Principle of Least Privilege

### Bad (Over-Permissioned)

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
// This is admin access. NEVER give this to a service.
```

### Good (Scoped)

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::my-app-uploads/*"
}
// Only read/write to ONE specific bucket's contents
```

### Real-World Example

Your app needs to:
- Read/write user uploads to S3
- Fetch DB password from Secrets Manager
- Send emails via SES

**Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-app-uploads/*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-south-1:123456:secret:prod/myapp/*"
    },
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "ses:FromAddress": "noreply@myapp.com" }
      }
    }
  ]
}
```

---

## 06 — MFA (Multi-Factor Authentication)

### Where to Enforce MFA

- ✅ Root account (mandatory)
- ✅ All IAM users with console access
- ✅ Any action that modifies infrastructure (via policy conditions)

### Requiring MFA for Dangerous Actions

```json
{
  "Effect": "Deny",
  "Action": ["ec2:TerminateInstances", "rds:DeleteDBInstance"],
  "Resource": "*",
  "Condition": {
    "BoolIfExists": { "aws:MultiFactorAuthPresent": "false" }
  }
}
```

---

## 🧠 Quick Recall

1. User vs Role — when use each?
2. Why never put AWS keys on EC2?
3. What does "least privilege" mean practically?
4. How does EC2 get credentials without keys on disk?
5. What's the instance metadata endpoint?
6. Effect + Action + Resource = ?

---

## 🎯 Interview Q&A

**Q: How does an EC2 instance access S3 without access keys?**

A: Attach an IAM Role to the instance (via Instance Profile). The AWS SDK on EC2 automatically fetches temporary credentials from the instance metadata service (169.254.169.254). These rotate every ~6 hours. No keys on disk, no manual rotation.

**Q: What's the difference between identity-based and resource-based policies?**

A: Identity-based: attached to a user/group/role ("This user CAN do X"). Resource-based: attached to the resource itself ("This S3 bucket ALLOWS access from account Y"). Resource-based enables cross-account access without assuming roles.

**Q: How would you audit IAM permissions in a large organization?**

A: AWS IAM Access Analyzer (finds unused permissions, external access). CloudTrail (logs all API calls — who did what when). Regular access reviews. AWS Organizations SCPs (guardrails across all accounts). IAM Access Advisor (shows last-used timestamps for each permission).

**Q: Explain the difference between SCP and IAM Policy.**

A: SCP (Service Control Policy): organization-level guardrail that limits what ANY user/role in an account can do, regardless of their IAM policies. It's a ceiling, not a grant. IAM Policy: grants permissions within that ceiling. You need both SCP-allows AND IAM-allows for an action to succeed.

---

## 🤔 Brainstorming Questions

1. **If temporary credentials from instance metadata auto-rotate, what happens to long-running processes** that cached the old credentials? (SDK handles refresh, but what about custom code?)

2. **An attacker gets SSRF on your EC2 and hits the metadata endpoint.** They now have your IAM role's temporary credentials. How do you defend? (IMDSv2 requires PUT + token, not just GET)

3. **You need to give a third-party SaaS access to your S3 bucket.** IAM user with keys? Cross-account role? Resource-based policy? What are the security tradeoffs of each?

4. **Why does AWS have BOTH "Allow" and "Deny" in policies?** If you just removed the Allow, wouldn't that be the same as Deny? (Think: explicit deny overrides any allow — useful for guardrails)

5. **IAM is eventually consistent.** What does this mean practically? Can a policy change cause a brief security gap?

---

*Previous: [Phase 9 — App Authentication](/aws-infrastructure/09-app-authentication) · Next: [Phase 11 — Monitoring & Logging](/aws-infrastructure/11-monitoring-logging)*
