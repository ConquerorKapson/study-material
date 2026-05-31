---
title: "Phase 6 — Domain, DNS & SSL/TLS"
description: "Making your site reachable and secure — domain setup, DNS records, HTTPS with Let's Encrypt, Elastic IPs."
order: 6
---

# Phase 6 — Domain, DNS & SSL/TLS

> **Category:** Infrastructure · **Difficulty:** Intermediate · **Related:** NGINX · Cloudflare · Security

---

## TLDR

Buy a domain → point its A record to your EC2's Elastic IP → install Let's Encrypt SSL cert → NGINX handles the TLS handshake. Without Elastic IP, your server changes address on every reboot. Without SSL, all traffic (passwords, tokens) is plaintext on the wire.

---

## 01 — The Real-World Analogy

| Concept | Analogy |
|---------|---------|
| Domain name | Your business name ("ACME Corp") |
| DNS A record | Your listing in the phone book (name → address) |
| Elastic IP | A permanent office address (doesn't change when you renovate) |
| SSL Certificate | Your government-issued business license proving you are who you say |
| Let's Encrypt | Free license-issuing authority |
| TLS Handshake | Showing your license to a new customer before exchanging documents |

---

## 02 — Domain Setup: The Path to Reachability

### Step-by-Step

```
1. Buy domain (Namecheap, GoDaddy, Route 53)
   → You now own "myapp.com"

2. Get a static IP (Elastic IP in AWS)
   → Allocate Elastic IP: 54.23.1.100
   → Associate with your EC2 instance

3. Create DNS A record:
   myapp.com → 54.23.1.100

4. (Optional) CNAME for www:
   www.myapp.com → myapp.com

5. Wait for propagation (TTL-dependent, usually 5-30 minutes)

6. Test: dig myapp.com → should return 54.23.1.100
```

### Elastic IP — Why You Need One

| Without Elastic IP | With Elastic IP |
|-------------------|-----------------|
| EC2 gets new public IP on every stop/start | IP stays fixed permanently |
| DNS A record becomes stale after reboot | A record always correct |
| Users get "site can't be reached" after maintenance | Zero impact on users |

> **Cost:** Free while attached to a running instance. **$0.005/hour if unattached** (Amazon charges for "wasted" IPs).

---

## 03 — SSL/TLS: Why HTTPS Is Non-Negotiable

### What Happens Without HTTPS

```
User ──── plain HTTP ────► Server
  │
  └── Anyone on the network can read:
      • Login passwords
      • Session tokens
      • Personal data
      • API responses
      
  AND can modify:
      • Inject ads into pages
      • Replace downloads with malware
      • Redirect to phishing sites
```

### What HTTPS Provides

| Property | Meaning |
|----------|---------|
| **Confidentiality** | No one can read the data in transit |
| **Integrity** | No one can modify data in transit |
| **Authentication** | Proves the server is who it claims to be |

---

## 04 — How TLS Works (The Handshake)

```
Browser                              Server (NGINX)
   │                                      │
   │── ClientHello ──────────────────────►│
   │   (supported ciphers, TLS version)   │
   │                                      │
   │◄── ServerHello + Certificate ────────│
   │   (chosen cipher, public cert)       │
   │                                      │
   │── Verify cert with CA ───────────────│
   │   (Is this cert signed by a          │
   │    trusted Certificate Authority?)   │
   │                                      │
   │── Key Exchange ─────────────────────►│
   │   (generate shared session key)      │
   │                                      │
   │◄═══ Encrypted traffic ══════════════►│
   │   (symmetric encryption with         │
   │    the session key, fast)            │
```

### Key Insight: Asymmetric → Symmetric

- **Asymmetric crypto** (public/private keys) is used ONLY during handshake to securely exchange a session key.
- **Symmetric crypto** (shared session key) encrypts ALL actual data. Much faster.
- This is why TLS handshake adds latency (1-2 round trips) but data transfer is fast.

---

## 05 — Let's Encrypt: Free SSL Certificates

### Setup with Certbot

```bash
# Install certbot + nginx plugin
sudo apt install certbot python3-certbot-nginx

# Get certificate (auto-configures NGINX!)
sudo certbot --nginx -d myapp.com -d www.myapp.com

# What just happened:
# 1. Certbot proved you control the domain (HTTP-01 challenge)
# 2. Let's Encrypt issued a certificate (valid 90 days)
# 3. Certbot modified your NGINX config to use the cert
# 4. Set up auto-renewal timer

# Verify auto-renewal works
sudo certbot renew --dry-run

# Check renewal timer
sudo systemctl list-timers | grep certbot
```

### How the HTTP-01 Challenge Works

```
1. Certbot asks Let's Encrypt: "I want a cert for myapp.com"
2. Let's Encrypt: "Prove you control it. Put this file at
   http://myapp.com/.well-known/acme-challenge/TOKEN"
3. Certbot creates the file (NGINX serves it)
4. Let's Encrypt fetches it from the public internet
5. If found → "You control this domain. Here's your cert."
```

> **This is why NGINX must be running on port 80 during renewal** — Let's Encrypt needs to reach that challenge file.

### Certificate Files

```
/etc/letsencrypt/live/myapp.com/
├── fullchain.pem    ← Your cert + intermediate certs (NGINX uses this)
├── privkey.pem      ← Your private key (NGINX uses this, never share!)
├── cert.pem         ← Just your certificate
└── chain.pem        ← Intermediate certificates only
```

---

## 06 — DNS Record Types Deep Dive

### Records You'll Configure

| Record | Example | Purpose | TTL Recommendation |
|--------|---------|---------|-------------------|
| A | `myapp.com → 54.23.1.100` | Main domain to IP | 3600 (stable), 60 (migrating) |
| CNAME | `www → myapp.com` | Alias to main domain | 3600 |
| A | `api.myapp.com → 54.23.1.100` | Subdomain for API | 3600 |
| MX | `myapp.com → aspmx.l.google.com` | Email routing | 3600 |
| TXT | SPF, DKIM records | Email authentication | 3600 |
| CAA | `0 issue "letsencrypt.org"` | Restrict who can issue certs | 3600 |

### Route 53 vs External DNS

| | Route 53 | External (Namecheap/Cloudflare) |
|--|----------|--------------------------------|
| Cost | $0.50/hosted zone/month | Often free with domain |
| Integration | Native AWS (health checks, failover) | Manual |
| Best for | Production with complex routing | Simple setups, Cloudflare proxy |

---

## 07 — Common Issues & Debugging

### "Site Can't Be Reached"

```bash
# Check DNS propagation
dig myapp.com
nslookup myapp.com

# Check if NGINX is listening
sudo ss -tlnp | grep -E '80|443'

# Check Elastic IP is associated
aws ec2 describe-addresses

# Check Security Group allows 80/443
```

### "Your Connection Is Not Private" (Certificate Error)

```bash
# Check cert expiry
sudo certbot certificates

# Check cert matches domain
openssl s_client -connect myapp.com:443 -servername myapp.com

# Force renewal
sudo certbot renew --force-renewal

# NGINX not picking up cert? Reload:
sudo nginx -t && sudo systemctl reload nginx
```

### Mixed Content Warnings

Your site loads over HTTPS but some resources (images, scripts) are loaded over HTTP. Fix: ensure ALL URLs use HTTPS or protocol-relative (`//cdn.example.com/...`).

---

## 🧠 Quick Recall

1. Why do you need an Elastic IP?
2. What are the 3 things HTTPS provides?
3. How does Let's Encrypt verify you own the domain?
4. Why do TLS certificates expire (90 days for LE)?
5. What's the difference between A and CNAME records?
6. Why is the handshake asymmetric but data transfer symmetric?

---

## 🎯 Interview Q&A

**Q: Explain how HTTPS works end-to-end.**

A: (1) TCP handshake establishes connection. (2) TLS handshake: client sends supported ciphers, server responds with certificate. (3) Client verifies cert chain against trusted CAs. (4) Key exchange (Diffie-Hellman or RSA) generates shared session key. (5) All subsequent data encrypted with symmetric cipher using session key. Asymmetric is only for the initial key exchange.

**Q: What happens if your SSL certificate expires?**

A: Browsers show "Your connection is not private" warning. Users can't reach your site (most won't click "proceed anyway"). Search rankings drop. APIs calling your endpoint fail with cert errors. Fix: `certbot renew` + reload NGINX. Prevention: automate renewal with cron/systemd timer.

**Q: A record vs CNAME — when to use each?**

A: A record maps domain to IP directly. CNAME maps domain to another domain (alias). Use A for root domain (bare myapp.com — CNAMEs technically can't be used at root per RFC). Use CNAME for subdomains (www, api) or when the target IP may change (CDN endpoints).

**Q: How would you do zero-downtime certificate rotation?**

A: Certbot handles this automatically — generates new cert, writes to same path, NGINX reload picks it up. For manual rotation: place new cert files, `nginx -t` to test, `systemctl reload nginx` (graceful — existing connections finish with old cert, new connections use new cert).

---

## 🤔 Brainstorming Questions

1. **Why does Let's Encrypt issue certificates for only 90 days** instead of 1-2 years? What security benefit does short-lived certs provide?

2. **Could someone get an SSL certificate for YOUR domain?** What prevents it? (CAA records, domain validation challenges)

3. **If TLS encrypts everything, how does Cloudflare inspect and cache your content?** (Think: where TLS terminates)

4. **You're migrating from one server to another.** How do you handle DNS + SSL without downtime? (TTL lowering, cert on new server first)

5. **Why do browsers trust Let's Encrypt?** What if Let's Encrypt got hacked? What's the CA trust model's weakest point?

---

*Previous: [Phase 5 — NGINX](/aws-infrastructure/05-nginx) · Next: [Phase 7 — Cloudflare](/aws-infrastructure/07-cloudflare)*
