---
title: "Domain, DNS, and SSL/TLS — Making Your Site Reachable and Secure"
description: "DNS record types, the TLS handshake, Let's Encrypt automation, Elastic IPs, and the full chain from domain purchase to green padlock."
order: 6
---

# Domain, DNS, and SSL/TLS — Making Your Site Reachable and Secure

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate · **Related:** DNS · SSL/TLS · Let's Encrypt · Route 53 · Elastic IP

---

## 01 — TLDR

- A domain name is a lease — you rent it from a registrar, you never truly "own" it
- DNS is the internet's phone book: translates human-readable names to IP addresses
- Six DNS record types cover 95% of use cases: A, AAAA, CNAME, MX, TXT, NS
- DNS resolution is a multi-step lookup: browser cache → OS cache → recursive resolver → root → TLD → authoritative
- Elastic IPs give your EC2 instance a permanent public IP that survives stop/start cycles
- HTTPS uses both asymmetric (key exchange) and symmetric (data transfer) encryption — understanding why is an interview favorite
- Let's Encrypt + Certbot gives you free, auto-renewing SSL certificates in minutes
- The TLS handshake happens in milliseconds but involves a complex trust chain verification

**Why this matters:** Without DNS and SSL, your application is unreachable (no domain) and untrustable (no HTTPS). Modern browsers actively warn users away from HTTP-only sites.

---

## 02 — Domain Names

### What You're Actually Buying

When you "buy" a domain, you're actually **leasing an entry** in a global registry:

```
You → Pay $12/year → Registrar (Namecheap, Google) → Registry (Verisign for .com)
```

- **Registry:** Organization that manages a TLD (.com, .org, .io). Verisign owns .com.
- **Registrar:** Company authorized to sell domain registrations (Namecheap, GoDaddy, Google Domains, Route 53).
- **Registrant:** You. The lessee.

### Domain Hierarchy

```
                    Root (.)
                    │
         ┌──────────┼──────────┐
         │          │          │
        .com       .org       .io        ← TLD (Top Level Domain)
         │
    example.com                          ← Second Level Domain (what you buy)
         │
    ┌────┼────┐
    │    │    │
   www  api  mail                        ← Subdomains (free, you control)
```

- **TLD (Top Level Domain):** .com, .org, .io, .dev, .app, .co
- **Second Level Domain:** example.com (this is what you register)
- **Subdomain:** www.example.com, api.example.com (you create these yourself, unlimited, free)

### Choosing a TLD

| TLD | Cost/year | Perception | Notes |
|-----|-----------|-----------|-------|
| .com | $10-15 | 🟢 Universal trust | Always the first choice if available |
| .io | $30-60 | 🟢 Tech/startup | Popular with developers |
| .dev | $12-15 | 🟢 Developer-focused | Enforces HTTPS (HSTS preloaded) |
| .app | $14-20 | 🟡 Modern | Also HSTS preloaded |
| .co | $25-30 | 🟡 Startup feel | Sometimes confused with .com |
| .xyz | $1-5 | 🔴 Cheap/spammy | Often blocked by spam filters |
| .info | $3-5 | 🔴 Spammy | Avoid for professional use |

---

## 03 — DNS Record Types

### The Essential Six

| Record | Points To | Example | Use Case |
|--------|-----------|---------|----------|
| **A** | IPv4 address | `example.com → 54.123.45.67` | Domain to server |
| **AAAA** | IPv6 address | `example.com → 2001:db8::1` | IPv6 support |
| **CNAME** | Another domain | `www → example.com` | Aliases/subdomains |
| **MX** | Mail server | `example.com → mail.google.com` | Email routing |
| **TXT** | Text string | `example.com → "v=spf1 ..."` | Verification, SPF, DKIM |
| **NS** | Nameserver | `example.com → ns1.route53.aws` | Delegation |

### Detailed Examples

```dns
; A Record — Point domain to your server's IP
example.com.        300    IN    A       54.123.45.67
api.example.com.    300    IN    A       54.123.45.67

; AAAA Record — IPv6 equivalent
example.com.        300    IN    AAAA    2001:0db8:85a3::8a2e:0370:7334

; CNAME — Alias one domain to another
www.example.com.    300    IN    CNAME   example.com.
blog.example.com.   300    IN    CNAME   mysite.ghost.io.

; MX — Email routing (lower number = higher priority)
example.com.        300    IN    MX      1  aspmx.l.google.com.
example.com.        300    IN    MX      5  alt1.aspmx.l.google.com.

; TXT — Verification and email security
example.com.        300    IN    TXT     "v=spf1 include:_spf.google.com ~all"
example.com.        300    IN    TXT     "google-site-verification=abc123..."
_dmarc.example.com. 300    IN    TXT     "v=DMARC1; p=quarantine;"

; NS — Nameserver delegation
example.com.        86400  IN    NS      ns-123.awsdns-45.com.
example.com.        86400  IN    NS      ns-678.awsdns-90.org.
```

### TTL (Time To Live) Explained

TTL is the **cache duration** — how long resolvers remember your answer before asking again.

| TTL Value | Duration | Use Case |
|-----------|----------|----------|
| 60 | 1 minute | During migrations (fast switch) |
| 300 | 5 minutes | ✅ Good default for dynamic records |
| 3600 | 1 hour | Stable records |
| 86400 | 24 hours | Very stable (NS records) |

**Migration strategy:**
1. Days before migration: lower TTL to 60s
2. Make the DNS change
3. Wait for propagation (max = old TTL)
4. After confirming: raise TTL back to 300-3600

### CNAME Restrictions (Important!)

```
✅ CNAME is valid for subdomains:
   www.example.com  CNAME  example.com
   api.example.com  CNAME  my-alb-123.us-east-1.elb.amazonaws.com

❌ CNAME is NOT valid at the apex (root domain):
   example.com      CNAME  something.else.com  ← VIOLATES DNS SPEC!
```

**Why?** CNAME means "this name is an alias for that name." But the root domain must also have SOA and NS records, which conflict with CNAME.

**Solutions for root domain:**
- Use an A record pointing to your IP
- Use Route 53 Alias records (AWS-specific, works at apex)
- Use Cloudflare's CNAME flattening

---

## 04 — DNS Resolution Deep Dive

### Full Resolution Trace

```
User types: www.example.com

Step 1: Browser cache
  └─ "Have I seen this domain in the last few minutes?" → Miss

Step 2: OS cache (hosts file + resolver cache)
  └─ Check /etc/hosts, then OS DNS cache → Miss

Step 3: Recursive Resolver (ISP or 8.8.8.8)
  └─ "I'll find the answer for you"
  │
  │  Step 3a: Ask Root Server (.)
  │  └─ "Who handles .com?" → "Go ask a]gtld-servers.net"
  │
  │  Step 3b: Ask TLD Server (.com)
  │  └─ "Who handles example.com?" → "Go ask ns1.route53.amazonaws.com"
  │
  │  Step 3c: Ask Authoritative Server (Route 53)
  │  └─ "What's the A record for www.example.com?"
  │     → "54.123.45.67, TTL=300"
  │
  └─ Cache the answer for 300 seconds

Step 4: Return 54.123.45.67 to browser

Total time: 20-100ms (first lookup), <1ms (cached)
```

### Timing Breakdown

| Step | Typical Latency | Cacheable? |
|------|-----------------|-----------|
| Browser cache | 0ms | ✅ Session-based |
| OS cache | <1ms | ✅ TTL-based |
| Recursive resolver cache | <1ms | ✅ TTL-based |
| Root server query | 5-20ms | ✅ 48 hours |
| TLD server query | 10-30ms | ✅ 48 hours |
| Authoritative query | 10-50ms | ✅ Per TTL |

### Why DNS "Propagation" Takes Time

DNS doesn't actually "propagate" — there's no push mechanism. Instead:

1. You change the A record from `1.2.3.4` to `5.6.7.8`
2. Every resolver that cached the old answer keeps serving `1.2.3.4` until their cache expires
3. Different ISPs, different users, different cache expiry times
4. **Maximum propagation time = old TTL value**

This is why you lower TTL before making changes.

---

## 05 — Route 53

### What It Is

AWS's managed DNS service. It's called "Route 53" because DNS uses port 53.

### Key Concepts

| Concept | What It Is |
|---------|-----------|
| Hosted Zone | A container for DNS records for one domain |
| Record Set | The actual DNS entries (A, CNAME, etc.) |
| Alias Record | AWS-specific — works like CNAME but at apex |
| Health Check | Monitors endpoint, used for failover routing |

### Routing Policies

| Policy | How It Works | Use Case |
|--------|-------------|----------|
| **Simple** | Returns one value | Single server |
| **Weighted** | Distributes by % | A/B testing, gradual migration |
| **Latency** | Routes to closest region | Multi-region apps |
| **Failover** | Primary → secondary on failure | High availability |
| **Geolocation** | Routes by user's country | Compliance, localization |
| **Multi-value** | Returns multiple healthy IPs | Poor man's load balancer |

### Example: Failover Routing

```
Primary: US-East-1 (54.123.45.67)
  │
  └─ Health check: GET /health every 30s
       │
       ├─ Healthy → Route traffic here
       │
       └─ Unhealthy (3 consecutive failures) → Failover!
                                                    │
                                                    ▼
Secondary: US-West-2 (52.98.76.54)
```

### Route 53 Alias Records

```
# Regular CNAME (cannot be at apex):
www.example.com  CNAME  my-alb-123.us-east-1.elb.amazonaws.com

# Alias record (CAN be at apex, free queries to AWS resources):
example.com      A      ALIAS my-alb-123.us-east-1.elb.amazonaws.com
```

**Alias advantages:**
- Works at zone apex (root domain)
- No extra DNS query (resolved internally by AWS)
- Free for queries to AWS resources (ALB, CloudFront, S3)
- Automatically tracks IP changes of the target

---

## 06 — Elastic IP

### The Problem

```
EC2 Instance running → Public IP: 54.123.45.67
   │
   ▼ (you stop the instance)
EC2 Instance stopped → Public IP: NONE
   │
   ▼ (you start it again)
EC2 Instance running → Public IP: 52.87.99.12  ← DIFFERENT IP!
```

Your DNS A record still points to `54.123.45.67`. Your site is down.

### The Solution: Elastic IP

An Elastic IP is a **static public IPv4 address** that you allocate and attach to your instance.

```bash
# Allocate an Elastic IP
aws ec2 allocate-address --domain vpc
# Returns: 54.200.100.50

# Associate with your instance
aws ec2 associate-address \
  --instance-id i-1234567890abcdef0 \
  --allocation-id eipalloc-abcdef123
```

Now `54.200.100.50` stays with your instance across stops/starts.

### Cost (Important!)

| Scenario | Cost |
|----------|------|
| Elastic IP attached to **running** instance | ✅ Free |
| Elastic IP **not attached** to any instance | 🔴 $0.005/hour (~$3.60/month) |
| Elastic IP attached to **stopped** instance | 🔴 $0.005/hour |
| Additional Elastic IP on same instance | 🔴 $0.005/hour each |

**AWS charges for unused Elastic IPs** to discourage hoarding scarce IPv4 addresses.

### Limits

- Default: **5 Elastic IPs per region** (can request increase)
- One Elastic IP per instance (additional costs extra)

### When NOT to Use Elastic IP

| Scenario | Better Alternative |
|----------|-------------------|
| Auto-scaling group | Use ALB (Application Load Balancer) |
| Multiple servers | ALB + CNAME/Alias |
| Short-lived instances | Dynamic DNS or ALB |
| Cost-sensitive | Use a load balancer's DNS name |

---

## 07 — SSL/TLS Fundamentals

### The Two Types of Encryption

#### Asymmetric Encryption (Public/Private Key)

```
Alice has: Public Key (shared with everyone) + Private Key (secret)

Anyone can encrypt WITH the public key:
  Bob → [Public Key] → Encrypted message → Only Alice can decrypt

Only Alice can decrypt WITH the private key:
  Encrypted message → [Private Key] → Original message
```

- **Slow** (complex math — RSA, ECDSA)
- Used for: key exchange, digital signatures
- Analogy: A locked mailbox — anyone can drop a letter in (public key), only you have the key to open it (private key)

#### Symmetric Encryption (Shared Secret)

```
Both parties have the SAME key:
  Alice → [Shared Key] → Encrypted → [Shared Key] → Bob decrypts
```

- **Fast** (simple operations — AES)
- Used for: actual data transfer
- Problem: How do you share the key securely? (Chicken-and-egg)

### Why HTTPS Uses Both

```
1. ASYMMETRIC: Securely exchange a random session key
   (slow, but only happens once)

2. SYMMETRIC: Use that session key to encrypt all data
   (fast, used for entire connection)
```

**This is the fundamental answer to the interview question:** "Why does TLS use both symmetric and asymmetric encryption?"

> **Interview Callout:** "Explain the TLS handshake in detail. Why does it use both symmetric and asymmetric encryption?"
>
> "TLS uses asymmetric encryption (RSA/ECDHE) for the initial key exchange because it solves the chicken-and-egg problem — two strangers need to agree on a shared secret over an untrusted network. Once they've securely exchanged a session key, they switch to symmetric encryption (AES) for actual data transfer because it's 1000x faster. The handshake is expensive (asymmetric math), but it only happens once per connection. All subsequent data uses the fast symmetric cipher. It's like using a secure courier to deliver a house key, then using that key for all future visits."

---

## 08 — The TLS Handshake

### Step by Step

```
Client                                            Server
  │                                                  │
  │──── ClientHello ──────────────────────────────▶│
  │     • TLS version (1.2, 1.3)                    │
  │     • Supported cipher suites                   │
  │     • Random number (client_random)             │
  │     • SNI (server name indication)              │
  │                                                  │
  │◀──── ServerHello ────────────────────────────── │
  │     • Chosen TLS version                        │
  │     • Chosen cipher suite                       │
  │     • Random number (server_random)             │
  │                                                  │
  │◀──── Certificate ───────────────────────────── │
  │     • Server's SSL certificate                  │
  │     • Certificate chain (intermediate CAs)      │
  │                                                  │
  │     [Client verifies certificate]               │
  │     • Is it expired?                            │
  │     • Is it issued by a trusted CA?             │
  │     • Does the domain match?                    │
  │     • Is it revoked? (OCSP/CRL)                │
  │                                                  │
  │──── Key Exchange ─────────────────────────────▶│
  │     • Pre-master secret (encrypted with         │
  │       server's public key)                      │
  │                                                  │
  │     [Both sides compute session key]            │
  │     session_key = PRF(pre_master,               │
  │                       client_random,            │
  │                       server_random)            │
  │                                                  │
  │──── Finished (encrypted) ─────────────────────▶│
  │◀──── Finished (encrypted) ─────────────────────│
  │                                                  │
  │═══════ All data encrypted with session_key ════│
```

### TLS 1.3 Improvement

TLS 1.3 reduces the handshake from **2 round trips to 1** (and supports 0-RTT for returning clients):

```
TLS 1.2: ClientHello → ServerHello+Cert → KeyExchange → Finished (2 RTT)
TLS 1.3: ClientHello+KeyShare → ServerHello+Cert+Finished (1 RTT)
```

This means ~100ms faster connection time on every new HTTPS session.

---

## 09 — Let's Encrypt and Certbot

### What Let's Encrypt Is

- **Free** SSL/TLS certificates (unlimited)
- **Automated** — Certbot handles issuance and renewal
- **90-day validity** — forces automation (no "forgot to renew" disasters)
- **ACME protocol** — standard for automated certificate management

### Installation and Usage

```bash
# Install Certbot with NGINX plugin (Ubuntu)
sudo apt install -y certbot python3-certbot-nginx

# Get certificate (interactive — NGINX plugin auto-configures)
sudo certbot --nginx -d example.com -d www.example.com

# Get certificate (non-interactive)
sudo certbot --nginx \
  -d example.com \
  -d www.example.com \
  --non-interactive \
  --agree-tos \
  --email admin@example.com

# Verify auto-renewal timer
sudo systemctl status certbot.timer

# Test renewal (dry run)
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

### Challenge Types

| Challenge | How It Works | When to Use |
|-----------|-------------|-------------|
| **HTTP-01** | Certbot places a file at `/.well-known/acme-challenge/` | ✅ Default, works with NGINX |
| **DNS-01** | Certbot creates a TXT record | Wildcard certs, no web server |
| **TLS-ALPN-01** | Certbot responds on port 443 | When only 443 is available |

### HTTP-01 Challenge Flow

```
1. Certbot → Let's Encrypt: "I want a cert for example.com"
2. Let's Encrypt → Certbot: "Prove you control it. Put this token at
                              http://example.com/.well-known/acme-challenge/TOKEN"
3. Certbot creates the file on your server
4. Let's Encrypt fetches the URL → finds the token → verified!
5. Let's Encrypt issues the certificate
6. Certbot installs it in NGINX and reloads
```

### Auto-Renewal

Certbot installs a systemd timer or cron job:

```bash
# Check the timer
systemctl list-timers | grep certbot

# The renewal runs twice daily (only acts if cert expires within 30 days)
# /etc/cron.d/certbot or systemd timer

# Post-renewal hook (reload NGINX to pick up new cert)
sudo certbot renew --deploy-hook "systemctl reload nginx"
```

### Certificate Files

```
/etc/letsencrypt/live/example.com/
├── cert.pem        # Your certificate only
├── chain.pem       # Intermediate CA certificates
├── fullchain.pem   # cert.pem + chain.pem (use THIS in NGINX)
└── privkey.pem     # Your private key (keep SECRET)
```

```nginx
# In NGINX configuration:
ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
```

---

## 10 — Certificate Chain

### The Trust Hierarchy

```
Root CA (pre-installed in browsers/OS)
  │
  ├── Intermediate CA (issued by Root CA)
  │     │
  │     └── Your Certificate (issued by Intermediate CA)
  │           └── example.com
  │
  └── Another Intermediate CA
        │
        └── Another Certificate
              └── other-site.com
```

### Why `fullchain.pem` Matters

```
❌ Using only cert.pem:
   Browser gets: [Your Cert] → signed by Intermediate CA
   Browser asks: "Who is this Intermediate CA? I don't have it in my trust store!"
   Result: SSL error on some browsers (especially mobile)

✅ Using fullchain.pem:
   Browser gets: [Your Cert] + [Intermediate CA Cert]
   Browser traces: Your Cert → Intermediate CA → Root CA (in trust store!)
   Result: ✅ Green padlock everywhere
```

### Verifying Your Certificate Chain

```bash
# Check certificate details
openssl x509 -in /etc/letsencrypt/live/example.com/cert.pem -text -noout

# Verify the full chain
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt \
  /etc/letsencrypt/live/example.com/fullchain.pem

# Check what a remote server is serving
openssl s_client -connect example.com:443 -servername example.com

# Check expiry date
echo | openssl s_client -connect example.com:443 2>/dev/null | \
  openssl x509 -noout -dates
```

---

## 11 — HTTPS Everywhere

### HTTP → HTTPS Redirect

```nginx
# Method 1: Separate server block (recommended)
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}

# Method 2: If/else in same block (less clean)
server {
    listen 80;
    listen 443 ssl;
    if ($scheme = http) {
        return 301 https://$host$request_uri;
    }
}
```

### HSTS (HTTP Strict Transport Security)

```nginx
# Tell browsers: "NEVER use HTTP for this domain again"
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

| Parameter | Meaning |
|-----------|---------|
| `max-age=31536000` | Remember for 1 year |
| `includeSubDomains` | Apply to all subdomains too |
| `preload` | Eligible for browser preload list |

⚠️ **Warning:** HSTS is hard to undo. Once a browser sees this header, it refuses HTTP for the specified duration. Start with a short max-age (e.g., 300) during testing.

### HSTS Preload

Browsers ship with a hardcoded list of HSTS domains. To get on it:
1. Serve HSTS header with `preload` directive
2. Submit to https://hstspreload.org
3. Wait ~weeks for inclusion in Chrome/Firefox/Safari

### Mixed Content

```
Page loaded via HTTPS but contains:
  <img src="http://example.com/image.jpg">     ← BLOCKED by browser
  <script src="http://cdn.com/lib.js">         ← BLOCKED by browser
  <link href="http://fonts.com/font.css">      ← BLOCKED by browser
```

**Fix:** Use protocol-relative or HTTPS URLs:
```html
<img src="https://example.com/image.jpg">
<img src="//example.com/image.jpg">  <!-- protocol-relative (uses page's protocol) -->
```

---

## 12 — Step-by-Step: Domain to HTTPS

### Complete Walkthrough

```
1. REGISTER DOMAIN
   └─ Namecheap/Route 53: register example.com ($12/year)

2. ALLOCATE ELASTIC IP
   └─ AWS Console: EC2 → Elastic IPs → Allocate
   └─ Associate with your EC2 instance
   └─ Note the IP: 54.200.100.50

3. CONFIGURE DNS
   └─ Create A record: example.com → 54.200.100.50
   └─ Create A record: www.example.com → 54.200.100.50
   └─ (or CNAME: www → example.com)
   └─ Set TTL to 300

4. WAIT FOR PROPAGATION
   └─ Check: nslookup example.com
   └─ Check: dig example.com +short
   └─ Usually 5-30 minutes (up to TTL of old record)

5. INSTALL NGINX (if not already)
   └─ sudo apt install -y nginx
   └─ Create server block for your domain

6. INSTALL SSL WITH CERTBOT
   └─ sudo certbot --nginx -d example.com -d www.example.com
   └─ Certbot auto-modifies your NGINX config

7. VERIFY
   └─ https://example.com → ✅ Green padlock
   └─ http://example.com → 301 redirect to https://
   └─ Check: https://www.ssllabs.com/ssltest/

8. ENABLE AUTO-RENEWAL
   └─ sudo certbot renew --dry-run
   └─ Verify timer: systemctl list-timers | grep certbot
```

---

## 13 — "What Would Go Wrong If..." Scenarios

### Certificate Expired

**What users see:** Big red warning page — "Your connection is not private" / "NET::ERR_CERT_DATE_INVALID"

**What goes wrong:**
- All traffic drops to zero (users won't click through the warning)
- Search engines may de-index you
- API integrations fail (they validate certs strictly)
- Trust is broken — users wonder if you've been hacked

**Prevention:**
```bash
# Set up monitoring
# 1. Certbot auto-renewal (default)
sudo certbot renew --dry-run

# 2. External monitoring (e.g., UptimeRobot checks cert expiry)

# 3. Manual check
echo | openssl s_client -connect example.com:443 2>/dev/null | \
  openssl x509 -noout -enddate
# notAfter=Mar 15 00:00:00 2025 GMT
```

### DNS Propagation Delay

**Scenario:** You change DNS from old server to new server.

**What goes wrong:**
- Some users see the new site, some see the old site
- Users in different countries/ISPs see different versions
- Can last up to 48 hours (worst case with high TTL)
- You can't force it — each resolver caches independently

**Mitigation:**
1. Lower TTL to 60s **days before** the migration
2. Keep old server running during transition
3. After 48 hours, decommission old server
4. Raise TTL back to 300-3600

### Mixed Content Blocking

**Scenario:** Your page loads over HTTPS but includes an HTTP image.

**What goes wrong:**
- Browser blocks the resource (shows broken image / missing script)
- Console shows: "Mixed Content: The page was loaded over HTTPS, but requested an insecure resource"
- If it's a script: entire functionality may break
- The padlock shows ⚠️ warning instead of ✅

### Elastic IP Not Attached (Money Leak)

**Scenario:** You terminated an instance but forgot to release its Elastic IP.

**What goes wrong:**
- AWS charges $0.005/hour = **$3.60/month per unused EIP**
- Easy to forget, charges accumulate silently
- Common in dev/test environments

**Check and clean up:**
```bash
# Find unattached Elastic IPs
aws ec2 describe-addresses \
  --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
  --output table

# Release unused ones
aws ec2 release-address --allocation-id eipalloc-abc123
```

---

## 14 — Tech Lead Decision: DNS Provider Comparison

| Feature | Route 53 | Cloudflare | Namecheap DNS |
|---------|----------|-----------|---------------|
| **Cost** | $0.50/zone + $0.40/M queries | ✅ Free tier | ✅ Free with domain |
| **Performance** | 🟢 AWS global anycast | 🟢 Fastest global network | 🟡 Adequate |
| **DDoS protection** | Basic | 🟢 Enterprise-grade | ❌ None |
| **CDN included** | ❌ (use CloudFront) | ✅ Free CDN | ❌ |
| **SSL proxy** | ❌ | ✅ Universal SSL | ❌ |
| **AWS integration** | 🟢 Alias records, IAM | ❌ | ❌ |
| **Failover routing** | ✅ Built-in | ✅ Load balancing (paid) | ❌ |
| **Analytics** | CloudWatch | ✅ DNS analytics | ❌ |
| **Best for** | AWS-heavy stacks | Performance + security | Budget, simple sites |

### Decision Framework

```
Is your infrastructure primarily on AWS?
├── YES → Route 53
│         • Alias records for ALB/CloudFront/S3
│         • Health checks + failover routing
│         • IAM integration
│         • Same billing account
│
└── NO → Consider Cloudflare
          • Free CDN + DDoS protection
          • Universal SSL (even for origin)
          • Best global DNS performance
          • Great UI for DNS management
```

---

## 15 — Certificate Management Best Practices

### Production Checklist

| Practice | Status | Notes |
|----------|--------|-------|
| Auto-renewal configured | ⬜ | Certbot timer or cron |
| Renewal tested | ⬜ | `certbot renew --dry-run` |
| Monitor cert expiry | ⬜ | External service or script |
| Use `fullchain.pem` | ⬜ | Not just `cert.pem` |
| Key permissions restricted | ⬜ | `chmod 600 privkey.pem` |
| NGINX reload on renewal | ⬜ | `--deploy-hook` |
| HSTS enabled | ⬜ | After confirming HTTPS works |
| HTTP redirect to HTTPS | ⬜ | 301, not 302 |
| TLS 1.2+ only | ⬜ | Disable TLS 1.0/1.1 |
| Strong cipher suites | ⬜ | Mozilla recommended config |

### Monitoring Script

```bash
#!/bin/bash
# check-cert-expiry.sh — Run daily via cron

DOMAIN="example.com"
DAYS_WARNING=14

EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
  | openssl x509 -noout -enddate | cut -d= -f2)

EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$DAYS_LEFT" -lt "$DAYS_WARNING" ]; then
    echo "⚠️ SSL certificate for $DOMAIN expires in $DAYS_LEFT days!"
    # Send alert (email, Slack webhook, etc.)
fi
```

### Wildcard Certificates

```bash
# Wildcard cert covers *.example.com (all subdomains)
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/cloudflare.ini \
  -d example.com \
  -d "*.example.com"

# Note: Wildcard requires DNS-01 challenge (can't use HTTP-01)
# You need a DNS plugin for your provider
```

---

## 16 — DNS Debugging Tools

### nslookup

```bash
# Basic lookup
nslookup example.com
# Server:  8.8.8.8
# Address: 8.8.8.8#53
# Name:    example.com
# Address: 54.200.100.50

# Query specific record type
nslookup -type=MX example.com
nslookup -type=TXT example.com
nslookup -type=NS example.com

# Query specific DNS server
nslookup example.com 8.8.8.8        # Google DNS
nslookup example.com ns1.route53.aws # Authoritative directly
```

### dig (more detailed)

```bash
# Full query with timing
dig example.com
# ;; ANSWER SECTION:
# example.com.    300    IN    A    54.200.100.50
# ;; Query time: 23 msec

# Short answer only
dig example.com +short
# 54.200.100.50

# Trace full resolution path
dig example.com +trace
# Shows: root → TLD → authoritative → answer

# Check specific record types
dig example.com MX
dig example.com TXT
dig example.com NS

# Query specific nameserver
dig @8.8.8.8 example.com
dig @ns-123.awsdns-45.com example.com    # Direct to authoritative

# Check if propagation is complete
dig @8.8.8.8 example.com +short     # Google
dig @1.1.1.1 example.com +short     # Cloudflare
dig @208.67.222.222 example.com +short  # OpenDNS
```

### whois

```bash
# Domain registration info
whois example.com
# Registrar: Namecheap
# Creation Date: 2020-01-15
# Expiry Date: 2025-01-15
# Name Servers: ns-123.awsdns-45.com

# Check domain availability
whois available-domain.com
# "No match for..." = available
```

### Online Tools

| Tool | URL | Use Case |
|------|-----|----------|
| DNS Checker | dnschecker.org | Check propagation globally |
| SSL Labs | ssllabs.com/ssltest | Grade your SSL config |
| MX Toolbox | mxtoolbox.com | Email DNS diagnostics |
| Security Headers | securityheaders.com | Check HTTP security headers |
| What's My DNS | whatsmydns.net | Propagation checker |

---

## 17 — Common DNS Patterns

### Pointing Domain to EC2

```dns
; Simple setup — one server
example.com.       300  IN  A      54.200.100.50
www.example.com.   300  IN  CNAME  example.com.
```

### Pointing to AWS ALB

```dns
; Using Route 53 Alias (preferred)
example.com.       300  IN  A  ALIAS my-alb-123.us-east-1.elb.amazonaws.com.

; Using CNAME (only for subdomains)
api.example.com.   300  IN  CNAME  my-alb-123.us-east-1.elb.amazonaws.com.
```

### Email with Google Workspace

```dns
; MX records (priority matters — lower = preferred)
example.com.  300  IN  MX  1   aspmx.l.google.com.
example.com.  300  IN  MX  5   alt1.aspmx.l.google.com.
example.com.  300  IN  MX  5   alt2.aspmx.l.google.com.
example.com.  300  IN  MX  10  alt3.aspmx.l.google.com.
example.com.  300  IN  MX  10  alt4.aspmx.l.google.com.

; SPF (who can send email for your domain)
example.com.  300  IN  TXT  "v=spf1 include:_spf.google.com ~all"

; DKIM (email signature verification)
google._domainkey.example.com.  300  IN  TXT  "v=DKIM1; k=rsa; p=MIGf..."

; DMARC (what to do with failed emails)
_dmarc.example.com.  300  IN  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"
```

### Multi-Service Setup

```dns
; Main site → CloudFront CDN
example.com.        300  IN  A      ALIAS d123.cloudfront.net.
www.example.com.    300  IN  CNAME  d123.cloudfront.net.

; API → ALB
api.example.com.    300  IN  CNAME  my-alb-123.elb.amazonaws.com.

; Staging → separate EC2
staging.example.com. 300 IN  A      54.200.100.51

; Docs → GitHub Pages
docs.example.com.   300  IN  CNAME  yourorg.github.io.

; Status page → external service
status.example.com. 300  IN  CNAME  yourorg.statuspage.io.
```

---

## 18 — Route 53 Health Checks

### Configuration

```bash
# Create a health check
aws route53 create-health-check --caller-reference "$(date +%s)" --health-check-config '{
  "IPAddress": "54.200.100.50",
  "Port": 443,
  "Type": "HTTPS",
  "ResourcePath": "/health",
  "FullyQualifiedDomainName": "example.com",
  "RequestInterval": 30,
  "FailureThreshold": 3
}'
```

### Failover with Health Checks

```
DNS Query: example.com
  │
  ▼
Route 53 checks: Is primary healthy?
  │
  ├── YES → Return primary IP (54.200.100.50)
  │
  └── NO (3 consecutive failures) → Return failover IP (52.98.76.54)
```

This gives you automatic failover without any load balancer — pure DNS-level.

---

## 19 — Key Takeaways

1. **Domain ≠ ownership** — you're leasing a name. Renewals matter. Set auto-renew.
2. **Six record types cover everything** — A, AAAA, CNAME, MX, TXT, NS. Master these.
3. **TTL controls propagation speed** — lower before changes, raise after.
4. **CNAME cannot exist at apex** — use Alias (Route 53) or A record.
5. **Elastic IP prevents IP change on stop/start** — but costs money if unused.
6. **TLS uses both encryption types** — asymmetric for key exchange, symmetric for speed.
7. **Let's Encrypt is free and automated** — no excuse for HTTP in 2024.
8. **`fullchain.pem`** — always include the intermediate CA cert.
9. **HSTS is powerful but hard to undo** — start with short max-age.
10. **`dig +trace`** is your best DNS debugging friend — shows the entire resolution path.
11. **Monitor cert expiry** — an expired cert is a total outage with zero warning to users.
