---
title: "Cloudflare — CDN, DDoS Protection, and Edge Security"
description: "How Cloudflare sits in front of your infrastructure, caches content globally, stops attacks at the edge, and when to use each SSL mode."
order: 7
---

# Cloudflare — CDN, DDoS Protection, and Edge Security

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate · **Related:** CDN · DDoS · WAF · Edge · Caching

---

## 01 — TL;DR

- Cloudflare is a reverse proxy that sits between users and your origin server, providing caching, DDoS protection, and edge security
- A CDN caches static content at 300+ Points of Presence (PoPs) worldwide, reducing latency from hundreds of milliseconds to single digits
- DDoS protection absorbs massive attacks (L3/L4/L7) before they ever reach your infrastructure
- SSL/TLS mode must be **Full (Strict)** — Flexible mode leaves traffic between Cloudflare and your server in plaintext
- The WAF blocks common attacks (SQL injection, XSS) at the edge before requests hit your application
- DNS proxying (orange cloud) hides your origin IP; DNS-only (grey cloud) exposes it
- Workers enable serverless compute at the edge for custom logic without touching your origin

**Why this matters:** Without edge protection, a single DDoS attack can take down your entire infrastructure, and without a CDN, users on the other side of the world experience 200-500ms latency on every single request.

---

## 02 — What is a CDN?

A **Content Delivery Network** distributes copies of your content to servers around the world so users get served from the nearest location.

### The Analogy

Imagine a city with **one central library**. Every person in every neighborhood must travel to downtown to borrow a book — long commute, long lines.

Now imagine putting a **small library branch in every neighborhood** with copies of the most popular books. 90% of people get what they need instantly, and only rare books require a trip to the central location.

That's exactly what a CDN does:
- **Central library** = Your origin server (EC2 in us-east-1)
- **Branch libraries** = CDN Points of Presence (PoPs)
- **Popular books** = Static assets (images, CSS, JS, videos)
- **Rare books** = Dynamic content (API responses, personalized pages)

### Points of Presence (PoPs)

```
                    ┌─────────────────────────────────────┐
                    │         Without CDN                   │
                    │                                       │
  User (Tokyo)  ───────── 180ms ──────────►  EC2 (Virginia)
  User (London) ───────── 90ms  ──────────►  EC2 (Virginia)
  User (Sydney) ───────── 220ms ──────────►  EC2 (Virginia)
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │         With CDN (Cloudflare)         │
                    │                                       │
  User (Tokyo)  ────── 5ms ──►  PoP Tokyo    ──┐
  User (London) ────── 5ms ──►  PoP London   ──┼── Cache HIT (served instantly)
  User (Sydney) ────── 5ms ──►  PoP Sydney   ──┘
                    │                                       │
  Cache MISS ───────────────────────────────►  EC2 (Virginia)
                    └─────────────────────────────────────┘
```

### Key Performance Gains

| Metric | Without CDN | With CDN | Improvement |
|--------|-------------|----------|-------------|
| TTFB (Tokyo → Virginia) | ~180ms | ~5ms | 97% faster |
| Bandwidth on origin | 100% | ~10-20% | 80% reduction |
| Concurrent users before crash | ~1,000 | ~100,000+ | 100x capacity |
| Static asset load time | 500ms+ | 20-50ms | 90% faster |

---

## 03 — How Cloudflare Works

### The Setup Process

1. You own `myapp.com` registered at some registrar (GoDaddy, Namecheap, etc.)
2. You add your domain to Cloudflare
3. Cloudflare scans your existing DNS records
4. **You change your nameservers** at your registrar to point to Cloudflare's nameservers
5. Now ALL DNS queries for `myapp.com` go through Cloudflare first

### Orange Cloud vs Grey Cloud

```
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare DNS Dashboard                                      │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  Type  │ Name    │ Content        │ Proxy Status              │
│  ──────┼─────────┼────────────────┼─────────────────────────  │
│  A     │ @       │ 54.23.45.67    │ 🟠 Proxied (CDN+Security)│
│  A     │ api     │ 54.23.45.67    │ 🟠 Proxied               │
│  MX    │ @       │ mail.google... │ ⚪ DNS Only              │
│  A     │ mail    │ 54.23.45.68    │ ⚪ DNS Only              │
│  CNAME │ www     │ myapp.com      │ 🟠 Proxied               │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

| Mode | Icon | What Happens | Use When |
|------|------|-------------|----------|
| Proxied (Orange) | 🟠 | Traffic routes through CF. Origin IP hidden. CDN + WAF + DDoS active | Web traffic, APIs |
| DNS Only (Grey) | ⚪ | DNS resolves directly to your IP. No CF protection | Mail (MX), FTP, non-HTTP services |

> **Interview Callout:** "What happens when you enable Cloudflare proxy on a DNS record?"
> When proxied, a DNS lookup for your domain returns **Cloudflare's IP addresses** (not yours). All HTTP/HTTPS traffic flows through Cloudflare's network where it can be cached, filtered, and accelerated before being forwarded to your origin.

---

## 04 — The Request Flow with Cloudflare

### Full Architecture Diagram

```
┌─────────┐     ┌──────────────────────────────────────────────────┐     ┌─────────────────┐
│  USER   │     │              CLOUDFLARE EDGE                      │     │   YOUR ORIGIN   │
│ Browser │     │                                                    │     │                 │
└────┬────┘     └──────────────────────────────────────────────────┘     └────────┬────────┘
     │                                                                             │
     │  1. DNS Query: myapp.com                                                    │
     │─────────►  CF Nameserver returns CF PoP IP (nearest)                        │
     │                                                                             │
     │  2. HTTPS Request to CF PoP (5ms away)                                     │
     │─────────►┌─────────────────────────────────┐                               │
     │          │  Cloudflare PoP (e.g., Tokyo)    │                               │
     │          │                                   │                               │
     │          │  ┌─────────────────────────────┐ │                               │
     │          │  │ Step A: DDoS Check           │ │                               │
     │          │  │ Step B: WAF Rules            │ │                               │
     │          │  │ Step C: Bot Detection        │ │                               │
     │          │  │ Step D: Cache Lookup         │ │                               │
     │          │  └──────────────┬──────────────┘ │                               │
     │          │                 │                 │                               │
     │          │    CACHE HIT?   │                 │                               │
     │          │   ┌─────┴─────┐                  │                               │
     │          │   │YES        │NO (Cache Miss)   │                               │
     │          │   │           │                   │                               │
     │◄─────────│◄──┘           │───────────────────│──────────────►┌──────────┐   │
     │ Served!  │               │  3. Forward to    │               │  NGINX   │   │
     │ (5ms)    │               │     Origin        │               │    ↓     │   │
     │          │               │                   │               │  Node.js │   │
     │          │               │                   │               │    ↓     │   │
     │          │               │◄──────────────────│◄──────────────│   RDS    │   │
     │          │               │  4. Origin        │               └──────────┘   │
     │          │               │     Response      │                               │
     │          │               │                   │                               │
     │          │  ┌────────────┴────────────┐     │                               │
     │          │  │ Step E: Cache Response   │     │                               │
     │          │  │ Step F: Apply CF Headers │     │                               │
     │          │  └────────────┬────────────┘     │                               │
     │◄─────────│◄──────────────┘                   │                               │
     │ Served!  │                                   │                               │
     │(50-200ms)│                                   │                               │
     │          └───────────────────────────────────┘                               │
     │                                                                             │
```

### Response Headers Tell the Story

```http
HTTP/2 200
cf-cache-status: HIT          # 🟢 Served from cache (fast!)
cf-cache-status: MISS         # 🟡 Fetched from origin, now cached
cf-cache-status: DYNAMIC      # ⚠️ Not cached (API endpoint)
cf-cache-status: BYPASS       # 🔴 Cache intentionally skipped
cf-ray: 7a1b2c3d4e5f-NRT     # Unique request ID + PoP code (NRT = Tokyo Narita)
age: 3600                     # Seconds since cached (1 hour old)
```

---

## 05 — Caching

### What Gets Cached by Default

Cloudflare caches based on file extension:

| Cached by Default ✅ | NOT Cached by Default ❌ |
|----------------------|--------------------------|
| `.jpg`, `.png`, `.gif`, `.webp` | HTML pages |
| `.css`, `.js` | API responses (`/api/*`) |
| `.woff2`, `.ttf` (fonts) | Pages with cookies/auth |
| `.svg`, `.ico` | POST/PUT/DELETE requests |
| `.mp4`, `.webm` | Query string URLs (configurable) |

### Cache-Control Headers

Your origin server controls caching behavior:

```nginx
# NGINX configuration examples

# Static assets — cache aggressively (1 year)
location ~* \.(jpg|css|js|woff2)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# HTML — short cache or revalidate
location ~* \.html$ {
    add_header Cache-Control "public, max-age=300, must-revalidate";
}

# API — never cache
location /api/ {
    add_header Cache-Control "private, no-store, no-cache";
}
```

### Cache Levels

| Level | Behavior | Use Case |
|-------|----------|----------|
| Bypass | Never cache | Admin panels, authenticated pages |
| No Query String | Only caches exact URL matches | Standard pages |
| Standard | Ignores query string for caching | Default behavior |
| Aggressive | Caches everything including query strings | Static sites |
| Cache Everything | Forces caching even for HTML | Landing pages |

### Cache Purging

```bash
# Purge specific URL
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -d '{"files":["https://myapp.com/styles.css"]}'

# Purge everything (nuclear option — use sparingly!)
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -d '{"purge_everything":true}'
```

> **⚠️ What would go wrong if...** you cached a dynamic API response?
> Users would see stale data. Example: User A updates their profile, User B (served from cache) still sees old data. API endpoints returning user-specific data should ALWAYS have `Cache-Control: private, no-store`.

---

## 06 — DDoS Protection

### What Are DDoS Attacks?

**Distributed Denial-of-Service** — Overwhelm your server with traffic so legitimate users can't access it.

```
                    NORMAL TRAFFIC
    User A ──────┐
    User B ──────┼──────► Your Server (handles fine)
    User C ──────┘        Capacity: 1,000 req/s

                    DDoS ATTACK
    Bot 1   ─────┐
    Bot 2   ─────┤
    Bot 3   ─────┤
    ...          ├──────► Your Server (OVERWHELMED → DOWN)
    Bot 999 ─────┤        Receiving: 1,000,000 req/s
    Bot 1000─────┘
```

### Attack Layers

| Layer | Type | What It Targets | Example |
|-------|------|----------------|---------|
| L3/L4 | Volumetric | Network bandwidth | UDP flood, SYN flood (fill the pipe) |
| L4 | Protocol | Server resources | SYN flood (exhaust connection table) |
| L7 | Application | Your actual app | HTTP flood (10M GET /search?q=expensive) |

### How Cloudflare Absorbs Attacks

```
┌──────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE NETWORK                              │
│                                                                    │
│   Capacity: 209+ Tbps (bigger than most attacks combined)         │
│   300+ PoPs worldwide using ANYCAST routing                       │
│                                                                    │
│   Attack traffic (1 Tbps) gets distributed:                       │
│                                                                    │
│   PoP Tokyo:    absorbs ~3 Gbps     ──► Dropped                  │
│   PoP London:   absorbs ~3 Gbps     ──► Dropped                  │
│   PoP NYC:      absorbs ~3 Gbps     ──► Dropped                  │
│   ... (300+ PoPs each handle a fraction)                          │
│                                                                    │
│   Legitimate traffic:                                              │
│   Real User ──► PoP ──► ✅ Passes through ──► Your Origin        │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Under Attack Mode

When you're actively being DDoSed:

1. Navigate to Cloudflare Dashboard → Under Attack Mode → ON
2. All visitors see a **5-second interstitial page** (JavaScript challenge)
3. Bots can't execute JavaScript → blocked
4. Real humans pass through automatically after the challenge

### Protection Tiers

| Feature | Free | Pro ($20/mo) | Business ($200/mo) |
|---------|------|------|----------|
| L3/L4 DDoS protection | ✅ Unmetered | ✅ Unmetered | ✅ Unmetered |
| L7 DDoS protection | ✅ Basic | ✅ Advanced | ✅ Advanced |
| Under Attack Mode | ✅ | ✅ | ✅ |
| Rate Limiting rules | 1 rule | 10 rules | 25 rules |
| Bot Fight Mode | ✅ Basic | ✅ Super Bot Fight | ✅ Super Bot Fight |

---

## 07 — WAF (Web Application Firewall)

### What the WAF Blocks

```
Normal Request:
  GET /api/users/123  →  ✅ Passes WAF  →  Reaches your app

SQL Injection Attempt:
  GET /api/users/1' OR '1'='1  →  ❌ BLOCKED by WAF  →  Never reaches your app

XSS Attempt:
  POST /comments body: <script>steal(cookies)</script>  →  ❌ BLOCKED

Path Traversal:
  GET /files/../../etc/passwd  →  ❌ BLOCKED
```

### Managed Rulesets

| Ruleset | What It Catches | Free Tier |
|---------|----------------|-----------|
| Cloudflare Managed | Common vulnerabilities | ❌ (Pro+) |
| OWASP Core | Top 10 OWASP attacks | ❌ (Pro+) |
| Cloudflare Free | Very basic protection | ✅ |

### Custom WAF Rules

```
# Block requests from specific country accessing admin
Rule: (http.request.uri.path contains "/admin") and (ip.geoip.country eq "XX")
Action: Block

# Rate limit login attempts
Rule: (http.request.uri.path eq "/api/auth/login") and (http.request.method eq "POST")
Action: Rate Limit (10 requests per minute per IP)

# Block known bad user agents
Rule: (http.user_agent contains "sqlmap") or (http.user_agent contains "nikto")
Action: Block
```

---

## 08 — SSL Modes

### The Four SSL Modes

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│  OFF (Don't use)                                                          │
│  User ──── HTTP (plaintext) ────► CF ──── HTTP (plaintext) ────► Origin   │
│  ❌ Everything exposed. Never use this.                                   │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  FLEXIBLE (⚠️ DANGEROUS — false sense of security)                        │
│  User ──── HTTPS (encrypted) ──► CF ──── HTTP (PLAINTEXT!) ───► Origin   │
│  ⚠️ Users see padlock, but traffic between CF and you is EXPOSED          │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  FULL                                                                      │
│  User ──── HTTPS (encrypted) ──► CF ──── HTTPS (encrypted) ───► Origin   │
│  🟡 Encrypted, but CF doesn't verify origin cert (self-signed OK)         │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  FULL (STRICT) ✅ THE ONLY CORRECT CHOICE                                 │
│  User ──── HTTPS (encrypted) ──► CF ──── HTTPS (verified!) ───► Origin   │
│  ✅ Encrypted AND CF verifies your origin has a valid certificate          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Why Flexible SSL is Dangerous

> **⚠️ What would go wrong if...** you used Flexible SSL mode?
>
> Your users see a green padlock and think they're secure. But between Cloudflare and your server, traffic flows in **plaintext**. Any attacker on the network path (ISP, data center, compromised router) can:
> - Read passwords, tokens, and personal data
> - Modify responses (inject malware/ads)
> - Perform man-in-the-middle attacks
>
> It's worse than no SSL because users have a **false sense of security**.

### Setting Up Full (Strict)

```bash
# Option 1: Cloudflare Origin Certificate (free, 15-year validity)
# Download from CF Dashboard → SSL/TLS → Origin Server → Create Certificate

# Install on NGINX:
server {
    listen 443 ssl;
    ssl_certificate     /etc/ssl/cloudflare-origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare-origin-key.pem;
    
    # Only accept connections from Cloudflare IPs
    # (See Security Hardening section below)
}

# Option 2: Let's Encrypt (also works)
# certbot certonly --nginx -d myapp.com
```

---

## 09 — DNS Proxy vs DNS-Only

### When to Proxy (Orange Cloud) 🟠

| Record | Proxy? | Why |
|--------|--------|-----|
| `A` → web server | 🟠 Yes | CDN, WAF, DDoS protection |
| `CNAME` → `www` | 🟠 Yes | Same benefits |
| `A` → API server | 🟠 Yes | Rate limiting, bot protection |
| `MX` → mail server | ⚪ No | Email doesn't go through HTTP proxy |
| `A` → mail server | ⚪ No | SMTP needs direct connection |
| `SRV` → game server | ⚪ No | Non-HTTP protocols |
| `A` → FTP server | ⚪ No | FTP needs direct connection |

### Performance Implications

```
Proxied (🟠):
  DNS lookup → CF IP → CF processes (1-5ms) → Origin
  Benefits: Cache, WAF, DDoS, HTTP/3, Early Hints
  Drawback: Slight latency for cache misses (~5-10ms added)

DNS-Only (⚪):
  DNS lookup → Your actual IP (exposed!)
  Benefits: Direct connection, lower latency for non-HTTP
  Drawback: No protection, IP exposed to the world
```

> **⚠️ What would go wrong if...** your origin IP was leaked?
> Attackers can bypass Cloudflare entirely by sending requests directly to your IP. Your server has no DDoS protection, no WAF, and no rate limiting. Game over. Always keep your origin IP secret and restrict access to Cloudflare IPs only.

---

## 10 — Page Rules and Transform Rules

### Page Rules (Legacy but Simple)

```
# Force HTTPS
Match: http://myapp.com/*
Action: Always Use HTTPS

# Cache everything on static subdomain
Match: static.myapp.com/*
Action: Cache Level = Cache Everything, Edge TTL = 1 month

# Bypass cache for admin
Match: myapp.com/admin/*
Action: Cache Level = Bypass, Security Level = High

# 301 Redirect
Match: myapp.com/old-page
Action: Forwarding URL (301) → https://myapp.com/new-page
```

### Transform Rules (Modern, More Powerful)

```
# Rewrite URL path (user sees /blog, origin sees /content/blog)
URI Path: Rewrite to → concat("/content", http.request.uri.path)
When: starts_with(http.request.uri.path, "/blog")

# Add security headers
Response Header Modification:
  Set: X-Content-Type-Options = nosniff
  Set: X-Frame-Options = DENY
  Set: Strict-Transport-Security = max-age=31536000; includeSubDomains
```

### Bulk Redirects

For large-scale URL migrations (thousands of redirects):

```json
// Redirect list (upload via API or Dashboard)
{
  "/old-page-1": "/new-page-1",
  "/old-page-2": "/new-page-2",
  "/blog/2020/post": "/archive/2020/post"
}
```

---

## 11 — Performance Features

| Feature | What It Does | Impact |
|---------|-------------|--------|
| Auto-Minification | Removes whitespace from HTML/CSS/JS | 10-20% smaller files |
| Brotli Compression | Better compression than gzip | 15-25% smaller transfers |
| HTTP/2 | Multiplexing, header compression | Multiple files over one connection |
| HTTP/3 (QUIC) | UDP-based, 0-RTT connection | Faster on mobile/lossy networks |
| Early Hints (103) | Sends preload hints before full response | Browser starts fetching assets early |
| Rocket Loader | Defers JS loading | Faster initial render |
| Polish | Image optimization (lossy/lossless/WebP) | 30-50% smaller images |
| Mirage | Lazy-loads images on slow connections | Faster perceived load on mobile |

### HTTP/2 vs HTTP/3

```
HTTP/1.1:  One request per connection (or 6 parallel connections max)
           [──req1──][──req2──][──req3──] (sequential, head-of-line blocking)

HTTP/2:    Multiple requests multiplexed over one TCP connection
           [req1─────]
           [req2───]      (parallel, but TCP head-of-line blocking remains)
           [req3────────]

HTTP/3:    Multiple requests over QUIC (UDP)
           [req1─────]
           [req2───]      (parallel, NO head-of-line blocking, 0-RTT)
           [req3────────]
           + Handles packet loss better (lost packet doesn't block others)
```

---

## 12 — Cloudflare Workers

### What Are Workers?

Serverless functions that run at the **edge** (on the same PoPs that serve your cached content). Code executes in the Cloudflare network, not on your origin.

```javascript
// worker.js — A/B testing at the edge
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Split traffic 50/50 based on cookie or random
  const bucket = request.headers.get('cookie')?.includes('ab=B') 
    ? 'B' 
    : Math.random() < 0.5 ? 'A' : 'B'
  
  if (bucket === 'B') {
    url.pathname = '/new-homepage' + url.pathname
  }
  
  const response = await fetch(url, request)
  const newResponse = new Response(response.body, response)
  newResponse.headers.set('Set-Cookie', `ab=${bucket}; Path=/; Max-Age=86400`)
  return newResponse
}
```

### Common Use Cases

| Use Case | What It Does | Why at the Edge |
|----------|-------------|-----------------|
| A/B Testing | Route users to different versions | No origin load, instant decision |
| Geolocation Routing | Serve different content by country | CF knows user's country already |
| Header Manipulation | Add/remove/modify headers | Before request hits origin |
| Authentication | Validate JWT at edge | Block unauthorized before origin |
| URL Rewriting | Transform URLs | Complex routing without NGINX |
| Image Resizing | Resize on the fly | Cached per variant at edge |

---

## 13 — Security Hardening

### Block Direct Origin Access

Your origin server should ONLY accept connections from Cloudflare:

```bash
# AWS Security Group for your EC2/ALB
# Only allow inbound HTTPS from Cloudflare IP ranges

# Cloudflare IPv4 ranges (check https://cloudflare.com/ips for current list)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 173.245.48.0/20

aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 103.21.244.0/22

# ... (repeat for all CF ranges)
# Block ALL other inbound on 443
```

### NGINX Configuration: Only Accept Cloudflare

```nginx
# /etc/nginx/conf.d/cloudflare-only.conf

# Allow Cloudflare IPs
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
real_ip_header CF-Connecting-IP;

# Deny everyone else
# In server block:
server {
    listen 443 ssl;
    
    # Verify the request came from Cloudflare using Authenticated Origin Pulls
    ssl_client_certificate /etc/ssl/cloudflare-authenticated-origin-pull.pem;
    ssl_verify_client on;
}
```

### Authenticated Origin Pulls

Extra verification that the request genuinely came from Cloudflare (not someone who knows your IP and fakes CF headers):

1. Download Cloudflare's client certificate
2. Configure NGINX to require client cert verification
3. Enable in CF Dashboard: SSL/TLS → Origin Server → Authenticated Origin Pulls

---

## 14 — Cloudflare vs AWS CloudFront

### Tech Lead Decision

| Factor | Cloudflare | AWS CloudFront |
|--------|-----------|----------------|
| Setup complexity | Simple (change nameservers) | Medium (create distribution, configure origins) |
| DNS included | ✅ Yes (best-in-class) | ❌ No (use Route 53 separately) |
| DDoS protection | ✅ Free, unmetered | ✅ AWS Shield (Standard free, Advanced $3k/mo) |
| WAF | ✅ Basic free, good on Pro | ⚠️ AWS WAF ($5/rule/month + per request) |
| Edge compute | Workers (cheap, fast deploy) | Lambda@Edge (slower deploy, AWS-integrated) |
| SSL certs | ✅ Free, automatic | ✅ Free via ACM |
| Cost model | Flat per plan | Pay per request + transfer |
| AWS integration | External service | Native (S3, ALB, API Gateway) |
| Free tier | Generous (unlimited bandwidth) | 1 TB/month for 12 months |
| Global PoPs | 300+ cities | 400+ edge locations |

### When to Choose Cloudflare

- ✅ You want simple setup with DNS + CDN + security in one place
- ✅ You need free DDoS protection and basic WAF
- ✅ Your budget is limited (free tier is very generous)
- ✅ You want edge compute (Workers) that's cheaper than Lambda@Edge
- ✅ You're multi-cloud or not exclusively on AWS

### When to Choose CloudFront

- ✅ You're all-in on AWS and want native integration
- ✅ You serve content from S3 (CloudFront + S3 is seamless)
- ✅ You need fine-grained AWS IAM controls on CDN access
- ✅ You use API Gateway and want built-in CDN caching
- ✅ Enterprise compliance requires single-vendor (AWS)

---

## 15 — Cost Analysis

| Tier | Monthly Cost | Best For |
|------|-------------|----------|
| Free | $0 | Personal projects, startups, basic protection |
| Pro | $20/domain | Small businesses, OWASP WAF, image optimization |
| Business | $200/domain | SLA guarantees, custom WAF rules, priority support |
| Enterprise | Custom ($$$) | Large orgs, dedicated support, advanced DDoS |

### What You Get Free

- ✅ Unlimited bandwidth CDN (no transfer costs!)
- ✅ Unmetered DDoS protection (L3/L4/L7)
- ✅ Free SSL certificate (auto-renewed)
- ✅ 5 Page Rules
- ✅ Basic analytics
- ✅ DNS hosting
- ✅ Workers (100k requests/day free)

> **Interview Callout:** "How does a CDN improve performance? What are the cache invalidation challenges?"
>
> **Performance:** CDN reduces latency by serving content from geographically closer PoPs (5ms vs 200ms). It also reduces origin load (only cache misses hit your server), enabling you to handle 10-100x more users.
>
> **Cache invalidation challenges:** "There are only two hard things in computer science: cache invalidation and naming things." Problems include: stale content after deploy (use versioned file names or cache-busting query strings), over-purging (defeats the CDN purpose), inconsistency across PoPs (propagation delay), and caching dynamic content accidentally.

---

## 16 — Common Pitfalls and "What Would Go Wrong"

| Scenario | What Goes Wrong | Fix |
|----------|----------------|-----|
| Flexible SSL mode | MITM between CF and origin; passwords exposed in transit | Use Full (Strict) + origin certificate |
| Caching API responses | Users see stale/wrong data from other users | Set `Cache-Control: private, no-store` on APIs |
| Origin IP leaked | Attackers bypass CF, DDoS your server directly | CF-only security groups, never expose origin IP |
| Excessive cache purging | Negates CDN benefits, every request hits origin | Use versioned file names (style.abc123.css) |
| Proxying MX records | Email breaks (SMTP can't go through HTTP proxy) | Always grey-cloud mail records |
| No rate limiting | Bot scraping, credential stuffing attacks | CF Rate Limiting rules on sensitive endpoints |
| Ignoring CF-Connecting-IP | Rate limiting by IP sees only CF's IP (one "user") | Use `CF-Connecting-IP` header for real client IP |
