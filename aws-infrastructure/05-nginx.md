---
title: "Phase 5 — NGINX: The Gatekeeper"
description: "Reverse proxy, SSL termination, static serving, load balancing — why NGINX is the most important software on your server after your app."
order: 5
---

# Phase 5 — NGINX: The Gatekeeper

> **Category:** Infrastructure · **Difficulty:** Intermediate → Advanced · **Related:** EC2 · SSL/TLS · Security

---

## TLDR

NGINX sits between the internet and your app. It receives ALL incoming requests, decides where to route them (static files vs API), handles SSL decryption, compresses responses, adds security headers, and protects your backend from direct exposure. Your backend never faces the internet directly — NGINX is its bodyguard.

---

## 01 — The Real-World Analogy

NGINX is like a hotel concierge:

| NGINX Role | Concierge Analogy |
|-----------|-------------------|
| Reverse proxy | Routes guests to correct room (API → backend, static → files) |
| SSL termination | Handles security checkpoint at entrance (guests show ID here, not at room door) |
| Static file serving | Has a copy of the brochures — doesn't bother the manager |
| Rate limiting | "Sir, you've asked 100 questions in 1 minute. Please wait." |
| Load balancing | "Room 1 is busy, let me send you to Room 2" |
| Gzip | Compresses the brochure to fit in a smaller envelope |
| Security headers | Stamps every outgoing envelope with security instructions |

---

## 02 — Why Not Expose Your Backend Directly?

### Without NGINX (Bad)

```
Internet → your-ip:3000 → Node.js directly
```

Problems:
- ❌ Node.js handles SSL? Terrible performance
- ❌ Node.js serves static files? Wastes app CPU
- ❌ No compression, no caching headers
- ❌ Slow clients tie up Node.js event loop (slowloris)
- ❌ No rate limiting, no security headers
- ❌ Single point of failure (no load balancing)

### With NGINX (Good)

```
Internet → :443 → NGINX → localhost:3000 → Node.js
                        → /var/www/html → Static files
```

Benefits:
- ✅ SSL handled at NGINX (C code, blazing fast)
- ✅ Static files served without touching your app
- ✅ Gzip compression automatic
- ✅ Request buffering (protects against slow clients)
- ✅ Rate limiting built-in
- ✅ Security headers added automatically
- ✅ Can load-balance across multiple backends

---

## 03 — Core Architecture

```
                    INTERNET
                       │
                       ▼
              ┌────────────────┐
              │     NGINX      │
              │   (port 443)   │
              └───────┬────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
   /api/*        /static/*      Everything else
         │            │            │
         ▼            ▼            ▼
  localhost:3000   /var/www     /var/www/html
  (Node.js)       (files)      (SPA index.html)
```

---

## 04 — Configuration Deep Dive

### Full Production Config (Annotated)

```nginx
# /etc/nginx/sites-available/myapp

# HTTP → HTTPS redirect (all traffic on 80 goes to 443)
server {
    listen 80;
    server_name myapp.com www.myapp.com;
    
    # 301 = permanent redirect (browsers cache this)
    return 301 https://$host$request_uri;
}

# Main HTTPS server block
server {
    listen 443 ssl http2;    # http2 = multiplexing, faster
    server_name myapp.com www.myapp.com;

    # SSL certificates (from Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/myapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.com/privkey.pem;
    
    # Modern SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;

    # API routes → proxy to backend
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # Static frontend (SPA)
    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;  # SPA fallback
        
        # Cache static assets aggressively
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### Key Directives Explained

| Directive | What It Does | Why It Matters |
|-----------|-------------|----------------|
| `proxy_pass` | Forwards request to backend | Core reverse proxy function |
| `try_files` | Try file, then dir, then fallback | SPA routing (React/Vue) |
| `ssl_protocols TLSv1.2 TLSv1.3` | Only modern TLS | Disables vulnerable protocols |
| `proxy_set_header X-Real-IP` | Passes client IP to backend | Without this, backend sees 127.0.0.1 |
| `proxy_set_header X-Forwarded-Proto` | Tells backend "this was HTTPS" | Needed for secure cookie flags |
| `gzip on` | Compress responses | 60-80% smaller payloads |
| `expires 1y` | Browser caches for 1 year | Static assets never re-downloaded |

---

## 05 — Location Block Matching (Critical to Understand)

NGINX matches `location` blocks by priority:

```nginx
# Priority order:
location = /exact        { }  # 1st: Exact match
location ^~ /prefix      { }  # 2nd: Preferential prefix
location ~ /regex        { }  # 3rd: Case-sensitive regex
location ~* /regex       { }  # 4th: Case-insensitive regex
location /prefix         { }  # 5th: Normal prefix (longest wins)
location /               { }  # Last resort
```

### Practical Example

```nginx
location = /health {        # Only matches exactly /health
    return 200 'OK';
}

location /api/ {            # Matches /api/users, /api/posts, etc.
    proxy_pass http://localhost:3000;
}

location ~* \.(jpg|png|gif)$ {  # Matches any .jpg, .png, .gif
    expires 30d;
}

location / {                # Everything else → frontend
    root /var/www/html;
    try_files $uri /index.html;
}
```

---

## 06 — Rate Limiting (DDoS Protection)

```nginx
# Define rate limit zone (10 req/sec per IP)
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    location /api/ {
        # Allow burst of 20, delay after 10
        limit_req zone=api burst=20 delay=10;
        proxy_pass http://localhost:3000;
    }
}
```

| Parameter | Meaning |
|-----------|---------|
| `rate=10r/s` | 10 requests per second allowed |
| `burst=20` | Buffer up to 20 excess requests |
| `delay=10` | First 10 burst requests processed immediately, rest queued |
| If > burst | 503 returned |

---

## 07 — Load Balancing (Scaling to Multiple Backends)

```nginx
upstream backend {
    # Round-robin by default
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
    
    # Or weighted:
    # server localhost:3001 weight=3;
    # server localhost:3002 weight=1;
    
    # Health checks (NGINX Plus or use passive):
    # server localhost:3001 max_fails=3 fail_timeout=30s;
}

server {
    location /api/ {
        proxy_pass http://backend;
    }
}
```

This works perfectly with pm2 cluster mode — run 3 Node processes on different ports, NGINX distributes traffic.

---

## 08 — Common Operations

```bash
# Test config before reloading (catches syntax errors)
sudo nginx -t

# Reload without downtime (graceful)
sudo systemctl reload nginx

# Check status
sudo systemctl status nginx

# View access logs
tail -f /var/log/nginx/access.log

# View error logs (your first stop when debugging)
tail -f /var/log/nginx/error.log
```

---

## 🧠 Quick Recall

1. Why is SSL termination at NGINX better than at Node.js?
2. What does `try_files $uri $uri/ /index.html` do?
3. How does `proxy_set_header X-Real-IP` help your backend?
4. What's the location block matching priority?
5. What happens if rate limit is exceeded?
6. How do you reload NGINX without downtime?

---

## 🎯 Interview Q&A

**Q: What is a reverse proxy and why use one?**

A: A reverse proxy sits between clients and backend servers. Clients talk to the proxy, which forwards to the appropriate backend. Benefits: SSL termination, load balancing, caching, security (backend hidden), compression, rate limiting. NGINX and HAProxy are common choices.

**Q: Your site returns 502 Bad Gateway. How do you debug?**

A: 502 means NGINX connected but the upstream (your backend) is down or not responding. Steps: (1) Check if backend is running: `pm2 list` or `systemctl status`. (2) Check NGINX error log: `tail /var/log/nginx/error.log`. (3) Verify port matches: proxy_pass port = app listen port. (4) Check if app crashed: application logs.

**Q: How would you implement zero-downtime deployments with NGINX?**

A: pm2 cluster + `pm2 reload` (rolling restart). Or: blue-green with upstream blocks — deploy to new port, update NGINX upstream to new port, reload NGINX, stop old. Or: with ALB doing rolling updates across EC2 instances.

**Q: Explain the difference between `return 301` and `rewrite`.**

A: `return 301` is a simple redirect — client gets 301 response and re-requests new URL. Fast, clear. `rewrite` modifies the URI internally (client may not know) or can issue redirects with more complex regex patterns. Prefer `return` for simple redirects (more efficient).

---

## 🤔 Brainstorming Questions

1. **Why not use your cloud provider's load balancer (ALB) instead of NGINX?** When does each make sense? Can you use both?

2. **NGINX serves static files faster than Node.js.** Why? What's different about how they handle I/O? (Think: event loop vs epoll at C level)

3. **You have a WebSocket endpoint.** Does the NGINX config change? What about `proxy_pass`? (Hint: `Upgrade` and `Connection` headers)

4. **Rate limiting by IP works, but what about users behind a corporate NAT** (1000 employees, 1 IP)? How would you rate-limit more fairly?

5. **NGINX handles SSL but Cloudflare also handles SSL.** Isn't that redundant? What's the actual encryption path? (Answer: double encryption — Cloudflare↔user AND Cloudflare↔NGINX)

---

*Previous: [Phase 4 — EC2 Setup](/aws-infrastructure/04-ec2-setup) · Next: [Phase 6 — Domain, DNS & SSL](/aws-infrastructure/06-domain-dns-ssl)*
