---
title: "Phase 7 — Cloudflare: Edge Layer"
description: "CDN, DDoS protection, WAF, SSL modes — the security and performance layer in front of everything."
order: 7
---

# Phase 7 — Cloudflare: Edge Layer

> **Category:** Infrastructure · **Difficulty:** Intermediate · **Related:** DNS · CDN · Security

---

## TLDR

Cloudflare sits between users and your server. It caches static content globally (CDN), absorbs DDoS attacks, blocks malicious requests (WAF), and handles SSL. You point your domain's nameservers to Cloudflare. Use **Full (Strict)** SSL mode always. Your tiny EC2 is now protected by one of the world's largest networks.

---

## 01 — The Real-World Analogy

Cloudflare is like a global network of bodyguards + copy shops:

| Cloudflare Feature | Analogy |
|-------------------|---------|
| CDN | Copy shops in every city — local copies of your brochures |
| DDoS protection | Bodyguards absorbing mob rushes |
| WAF | Security scanner checking bags for weapons |
| DNS proxy | Your mail goes to bodyguard's address, not your home |
| SSL termination | Bodyguard verifies visitor ID, radios you their name |

---

## 02 — How Cloudflare Works (Architecture)

### Without Cloudflare

```
User ──────────────────────────────► Your EC2
         (direct connection)
```

### With Cloudflare

```
User → Cloudflare Edge (nearest city)
         ├── Is it cached? → YES → Return immediately (no hit to EC2)
         ├── Is it malicious? → YES → Block (403)
         └── Legitimate + not cached → Forward to EC2 (origin)
              │
              ▼
         Your EC2 → processes → response
              │
              ▼
         Cloudflare caches eligible responses for next time
```

### Setup Process

```
1. Sign up at Cloudflare (free tier)
2. Add your domain (myapp.com)
3. Cloudflare scans your DNS records
4. Change nameservers at your registrar:
   - ns1.cloudflare.com
   - ns2.cloudflare.com
5. All DNS now resolves through Cloudflare
6. The orange cloud (proxy) icon = traffic flows through Cloudflare
```

---

## 03 — CDN: Global Caching

### What Gets Cached

| Content Type | Cached by Default? | Cache-Control Header |
|-------------|-------------------|---------------------|
| HTML pages | ❌ No (dynamic) | `no-cache` or short TTL |
| JS/CSS bundles | ✅ Yes | `max-age=31536000, immutable` |
| Images (jpg, png, svg) | ✅ Yes | `max-age=86400` |
| API responses (JSON) | ❌ No | `no-store` |
| Fonts (woff2) | ✅ Yes | `max-age=31536000` |

### Performance Impact

```
Without CDN:
  User in Mumbai → EC2 in US-East = ~200ms latency per request

With CDN:
  User in Mumbai → Cloudflare Mumbai edge = ~20ms for cached content
  (10x faster for static assets!)
```

### Cache Control Headers (Your Server Sets These)

```nginx
# In NGINX — tell Cloudflare what to cache
location ~* \.(js|css|png|jpg|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    # Cloudflare sees "public" → caches at edge
}

location /api/ {
    add_header Cache-Control "no-store";
    # Cloudflare sees "no-store" → always forwards to origin
}
```

---

## 04 — SSL Modes (Critical Decision)

| Mode | User ↔ Cloudflare | Cloudflare ↔ Your Server | Secure? |
|------|-------------------|--------------------------|---------|
| **Off** | HTTP | HTTP | ❌ Never use |
| **Flexible** | HTTPS ✅ | HTTP ❌ | ❌ False sense of security |
| **Full** | HTTPS ✅ | HTTPS ✅ (any cert) | ⚠️ OK |
| **Full (Strict)** | HTTPS ✅ | HTTPS ✅ (valid cert) | ✅ **Always use this** |

### Why "Flexible" Is Dangerous

```
User → HTTPS → Cloudflare → HTTP → Your EC2
                                 ↑
            This leg is UNENCRYPTED!
            Anyone between Cloudflare and EC2 can read traffic.
            (Other AWS customers, ISPs, etc.)
```

### Full (Strict) = The Only Correct Choice

- Requires a valid SSL cert on your origin (Let's Encrypt works perfectly)
- End-to-end encryption verified
- If origin cert expires, Cloudflare returns 526 (signals the problem clearly)

---

## 05 — DDoS Protection

### What Cloudflare Absorbs

Your free-tier EC2 (1GB RAM) would die under 1000 req/sec. Cloudflare's network handles **>50 Tbps** of traffic.

```
Attack: 10 million requests/second from botnet
         │
         ▼
Cloudflare edge servers (300+ cities)
  → Absorb, analyze, block malicious traffic
  → Only legitimate requests reach your EC2
  → Your server sees maybe 100 req/sec (normal load)
```

### Layer 3/4 DDoS (Network floods)

Automatically blocked. No configuration needed.

### Layer 7 DDoS (Application-layer, looks like real traffic)

Handled by rate limiting rules and Bot Management. Free tier includes basic protection; Pro adds more.

---

## 06 — WAF (Web Application Firewall)

### What It Blocks

```
Attacker: GET /api/users?id=1; DROP TABLE users;--
           │
           ▼
Cloudflare WAF: "SQL injection detected" → 403 Blocked

Attacker: GET /page?q=<script>alert('xss')</script>
           │
           ▼
Cloudflare WAF: "XSS attempt detected" → 403 Blocked
```

### Free Tier WAF Rules

- Managed ruleset (OWASP Top 10 basics)
- Rate limiting (1 rule free)
- Bot detection (basic)

### Custom Rules Example

```
If (request.uri contains "/wp-admin" AND ip.src not in {your_ip})
  → Block

If (request.headers["User-Agent"] contains "BadBot")
  → Challenge (CAPTCHA)
```

---

## 07 — Cloudflare DNS Features

### Proxy Mode (Orange Cloud) vs DNS-Only (Grey Cloud)

| | Proxied (Orange) | DNS-Only (Grey) |
|--|-----------------|-----------------|
| Traffic flows through Cloudflare | ✅ Yes | ❌ No, direct to origin |
| CDN/caching | ✅ Active | ❌ None |
| DDoS protection | ✅ Active | ❌ None |
| Hides origin IP | ✅ Yes | ❌ IP visible |
| Use for | Web traffic (A, CNAME) | MX records, direct SSH |

> **Important:** SSH (port 22) doesn't go through Cloudflare proxy. You need the actual EC2 IP for SSH. Keep a DNS-only record like `ssh.myapp.com → actual IP` or just note the IP.

---

## 08 — The Complete Traffic Flow

```
User in Mumbai types: https://myapp.com/dashboard

1. DNS: myapp.com → Cloudflare edge IP (nearest to Mumbai)
2. TLS: User ↔ Cloudflare Mumbai (CF terminates first TLS)
3. Cloudflare checks:
   - WAF: is it malicious? → No
   - Cache: is /dashboard cached? → No (HTML, dynamic)
   - Rate limit: within limits? → Yes
4. Cloudflare connects to origin:
   - TLS: Cloudflare ↔ EC2 NGINX (second TLS, Full Strict)
   - HTTP: GET /dashboard → NGINX → Backend
5. Response returns:
   - Backend → NGINX → Cloudflare → User
   - Cloudflare adds: performance headers, minification, compression

User requests: /static/app.js (second request)
1. DNS: already resolved (cached)
2. Cloudflare: /static/app.js cached at Mumbai edge? → YES!
3. Returns cached file immediately (never hits EC2)
4. Latency: ~10-20ms instead of ~200ms
```

---

## 🧠 Quick Recall

1. What's the difference between Flexible and Full (Strict) SSL?
2. Why does Cloudflare use orange vs grey cloud icons?
3. How does caching reduce load on your EC2?
4. Can Cloudflare protect your SSH connection?
5. What types of attacks does WAF block?

---

## 🎯 Interview Q&A

**Q: Explain how a CDN works and why it improves performance.**

A: CDN = globally distributed cache. Static assets (JS, CSS, images) are copied to edge servers near users. User requests are served from nearest edge instead of distant origin. Benefits: lower latency, reduced origin load, better availability (edge can serve cached content even if origin is down temporarily).

**Q: What's the difference between Layer 3/4 and Layer 7 DDoS attacks?**

A: Layer 3/4 (network): SYN floods, UDP floods — massive traffic volume. Blocked by absorbing/filtering at network edge. Layer 7 (application): looks like real HTTP requests but in extreme volume or targeting expensive endpoints. Harder to detect — requires pattern analysis, rate limiting, CAPTCHA challenges.

**Q: Your origin IP leaks. What can an attacker do?**

A: Bypass Cloudflare entirely — connect directly to your EC2, circumventing WAF, rate limits, and DDoS protection. Mitigation: Security Group on EC2 should ONLY allow traffic from Cloudflare IP ranges (published at cloudflare.com/ips). Deny all other inbound on 80/443.

**Q: How do you purge the CDN cache after a deployment?**

A: Cloudflare API: purge everything or by URL/tag. Best practice: use content-hashed filenames (`app.a3b2c1.js`) so new deploys get new URLs automatically — no purge needed. HTML (unhashed) should have short TTL or `no-cache`.

---

## 🤔 Brainstorming Questions

1. **Cloudflare terminates TLS, then re-encrypts to your origin.** They can see all your plaintext data. Are you comfortable with this? What are the trust implications?

2. **If your EC2 goes down for 30 minutes**, what does Cloudflare serve? (Think: "Always Online" feature, stale cache, vs errors)

3. **You're serving API responses with personal data.** Should these go through Cloudflare's CDN cache? What headers prevent accidental caching of sensitive data?

4. **Why not just use AWS CloudFront instead of Cloudflare?** What are the tradeoffs? (Cost, ease of setup, DDoS, WAF integration)

5. **An attacker finds your origin IP from historical DNS records.** How would you rotate it? What else should you lock down? (Elastic IP replacement + SG restriction to CF IPs)

---

*Previous: [Phase 6 — Domain, DNS & SSL](/aws-infrastructure/06-domain-dns-ssl) · Next: [Phase 8 — EC2 ↔ RDS](/aws-infrastructure/08-ec2-rds-connection)*
