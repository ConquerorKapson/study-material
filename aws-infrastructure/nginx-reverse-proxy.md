---
title: "NGINX — Reverse Proxy, SSL Termination, and Production Web Server"
description: "How NGINX protects your backend, handles SSL, serves static files, and becomes the gatekeeper of your entire application."
order: 5
---

# NGINX — Reverse Proxy, SSL Termination, and Production Web Server

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate-Advanced · **Related:** NGINX · Reverse Proxy · SSL · Load Balancing · Static Files

---

## 01 — TLDR

- NGINX sits between the internet and your backend — it's the "bouncer" that handles SSL, serves static files, and proxies dynamic requests
- Event-driven architecture lets NGINX handle 10,000+ concurrent connections on minimal resources
- Configuration flows: main → events → http → server → location (most specific match wins)
- `proxy_pass` forwards requests to your Node.js/Python app running on localhost
- SSL termination means NGINX decrypts HTTPS so your app only deals with plain HTTP internally
- Security headers, rate limiting, and gzip compression are table-stakes production config
- Master one NGINX config and you can deploy anything

**Why this matters:** NGINX is the most deployed web server/reverse proxy on the internet. Every production deployment you'll ever touch will either use NGINX, sit behind it, or use something inspired by it.

---

## 02 — What is a Reverse Proxy?

### The Analogy

Think of a **company reception desk**:

- **Without receptionist (no reverse proxy):** Visitors walk directly to any employee's desk. They know exactly where everyone sits. They can bother anyone. No security.
- **With receptionist (reverse proxy):** All visitors check in at reception. The receptionist decides who to route them to. Visitors never see the internal layout. Bad actors get stopped at the door.

### Forward Proxy vs Reverse Proxy

```
FORWARD PROXY (client-side):
┌────────┐     ┌───────────┐     ┌────────────┐
│ Client │────▶│   Proxy   │────▶│   Server   │
└────────┘     └───────────┘     └────────────┘
Client hides behind proxy (VPN, corporate proxy)

REVERSE PROXY (server-side):
┌────────┐     ┌───────────┐     ┌────────────┐
│ Client │────▶│   NGINX   │────▶│  Backend   │
└────────┘     └───────────┘     └────────────┘
Server hides behind NGINX (the client only sees NGINX)
```

### Why Your Backend Should Never Face the Internet Directly

| Risk | Without NGINX | With NGINX |
|------|---------------|------------|
| DDoS attack | App crashes immediately | NGINX absorbs/rate-limits |
| SSL management | App handles crypto (slow) | NGINX handles it natively |
| Static files | App serves them (wasteful) | NGINX serves 10x faster |
| Security headers | Must implement in code | One config for all |
| Port exposure | App on port 3000 visible | Only 80/443 exposed |
| Multiple apps | Each needs its own port | One entry point routes all |

---

## 03 — How NGINX Processes Requests

### Event-Driven Architecture

```
Apache (traditional):                NGINX (event-driven):
┌─────────────────────┐              ┌─────────────────────┐
│ Thread 1 → Request  │              │ Worker Process 1    │
│ Thread 2 → Request  │              │   ├─ Connection 1   │
│ Thread 3 → Request  │              │   ├─ Connection 2   │
│ Thread 4 → Request  │              │   ├─ Connection ...  │
│ ...                  │              │   └─ Connection 1000│
│ Thread 1000 → Req   │              │                     │
└─────────────────────┘              │ Worker Process 2    │
1000 threads = 1000 requests         │   ├─ Connection 1   │
High memory, context switching       │   └─ Connection 1000│
                                     └─────────────────────┘
                                     2 workers = 2000+ requests
                                     Low memory, no thread overhead
```

**Why this matters for scale:**
- Apache: 1 thread per connection → runs out of memory at ~10K connections
- NGINX: Event loop per worker → handles 10K+ connections per worker process
- Typical NGINX worker handles **thousands** of simultaneous connections

### Worker Processes

```
Master Process (root)
├── Worker Process 1 (www-data) → handles connections
├── Worker Process 2 (www-data) → handles connections
├── Worker Process 3 (www-data) → handles connections
└── Worker Process 4 (www-data) → handles connections
```

- **Master process:** Reads config, manages workers, binds ports (runs as root)
- **Worker processes:** Handle actual requests (run as unprivileged user)
- **Rule of thumb:** `worker_processes auto;` = one per CPU core

---

## 04 — NGINX Configuration Anatomy

### Overall Structure

```nginx
# /etc/nginx/nginx.conf — Main configuration file

# Main context (global settings)
user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log warn;

# Events context (connection handling)
events {
    worker_connections 1024;
    multi_accept on;
    use epoll;
}

# HTTP context (web server settings)
http {
    # MIME types
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    access_log /var/log/nginx/access.log;

    # Performance
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    # Include site configurations
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

### The Include Pattern

```
/etc/nginx/
├── nginx.conf                    # Main config (rarely edited)
├── conf.d/
│   └── default.conf              # Default server block
├── sites-available/              # All site configs (inactive)
│   ├── myapp.conf
│   └── api.conf
├── sites-enabled/                # Symlinks to active sites
│   └── myapp.conf → ../sites-available/myapp.conf
├── snippets/                     # Reusable config fragments
│   ├── ssl-params.conf
│   └── security-headers.conf
└── mime.types                    # File extension → MIME type mapping
```

```bash
# Enable a site
sudo ln -s /etc/nginx/sites-available/myapp.conf /etc/nginx/sites-enabled/
# Disable a site
sudo rm /etc/nginx/sites-enabled/myapp.conf
# Test configuration
sudo nginx -t
# Reload (no downtime)
sudo systemctl reload nginx
```

---

## 05 — Server Blocks (Virtual Hosts)

### One NGINX, Multiple Domains

```nginx
# /etc/nginx/sites-available/app1.conf
server {
    listen 80;
    server_name app1.example.com;
    # ... app1 configuration
}

# /etc/nginx/sites-available/app2.conf
server {
    listen 80;
    server_name app2.example.com api.example.com;
    # ... app2 configuration
}

# /etc/nginx/sites-available/default.conf
server {
    listen 80 default_server;
    server_name _;
    return 444;  # Drop connection for unknown domains
}
```

### How NGINX Chooses a Server Block

1. Match by `listen` directive (port)
2. Match by `server_name` (domain)
3. If no match → use `default_server`
4. If no `default_server` → first server block in config

### Server Name Matching Priority

```nginx
server_name example.com;              # 1. Exact match (highest priority)
server_name *.example.com;            # 2. Leading wildcard
server_name example.*;                # 3. Trailing wildcard
server_name ~^api\d+\.example\.com$;  # 4. Regex (lowest priority)
```

---

## 06 — Location Blocks

### Match Types and Priority

```nginx
server {
    # 1. Exact match (highest priority, stops searching)
    location = /health {
        return 200 'OK';
    }

    # 2. Preferential prefix (stops searching if matched)
    location ^~ /static/ {
        root /var/www;
    }

    # 3. Regex match (case-sensitive)
    location ~ \.php$ {
        # Handle PHP files
    }

    # 4. Regex match (case-insensitive)
    location ~* \.(jpg|jpeg|png|gif|ico)$ {
        expires 30d;
    }

    # 5. Prefix match (lowest priority)
    location / {
        proxy_pass http://localhost:3000;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
    }
}
```

### Priority Order (memorize this)

| Priority | Modifier | Type | Stops? |
|----------|----------|------|--------|
| 1 | `=` | Exact match | ✅ Yes |
| 2 | `^~` | Preferential prefix | ✅ Yes |
| 3 | `~` | Regex (case-sensitive) | First match |
| 4 | `~*` | Regex (case-insensitive) | First match |
| 5 | (none) | Prefix | Longest match |

### The `try_files` Directive (Critical for SPAs)

```nginx
# For Single Page Applications (React, Vue, Angular)
location / {
    root /var/www/myapp/build;
    try_files $uri $uri/ /index.html;
}
# Translation:
# 1. Try to serve the exact file requested ($uri)
# 2. Try to serve it as a directory ($uri/)
# 3. Fall back to index.html (let the SPA router handle it)
```

**Without `try_files`:** Refreshing `/dashboard/users` returns 404 because there's no physical file at that path. The SPA router never gets a chance to handle it.

---

## 07 — Reverse Proxy Configuration

### Basic proxy_pass

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:3000;

        # Essential headers to forward
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Buffering
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }
}
```

### Headers Explained

| Header | Purpose | Without It |
|--------|---------|-----------|
| `Host` | Original domain requested | Backend sees localhost |
| `X-Real-IP` | Client's actual IP | Backend sees 127.0.0.1 |
| `X-Forwarded-For` | Chain of proxy IPs | Can't trace client |
| `X-Forwarded-Proto` | http or https | Can't detect HTTPS |

### WebSocket Proxying

```nginx
location /ws/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;

    # Longer timeout for persistent connections
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

### Upstream Blocks (Multiple Backends)

```nginx
upstream backend_cluster {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
    keepalive 32;  # Persistent connections to backends
}

server {
    location /api/ {
        proxy_pass http://backend_cluster;
        proxy_http_version 1.1;
        proxy_set_header Connection "";  # Enable keepalive
    }
}
```

---

## 08 — SSL/TLS Termination

### The Architecture

```
Client                    NGINX                    Backend
  │                         │                        │
  │──── HTTPS (encrypted) ──▶│                        │
  │                         │──── HTTP (plain) ──────▶│
  │                         │                        │
  │◀── HTTPS (encrypted) ───│                        │
  │                         │◀── HTTP (plain) ───────│
```

**Why this pattern:**
- NGINX is optimized for TLS (hardware acceleration, session caching)
- Backend doesn't need TLS overhead (saves CPU)
- Certificate management in one place
- Internal network is trusted (VPC)

### SSL Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    # Certificate files
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # SSL session caching (improves performance)
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # ... rest of server configuration
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}
```

---

## 09 — Static File Serving

### Why NGINX is Vastly Faster Than Node.js for Static Files

| Operation | Node.js | NGINX |
|-----------|---------|-------|
| Read file | Event loop + fs.readFile | sendfile() syscall (kernel-level) |
| Memory usage | Buffers in JS heap | Zero-copy (kernel → network) |
| Concurrency | Single-threaded | Multi-worker, event-driven |
| Caching | Manual implementation | Built-in, configurable |
| Throughput | ~5,000 req/s | ~50,000+ req/s |

### Configuration

```nginx
server {
    # Serve static files
    location /static/ {
        root /var/www/myapp;     # Serves /var/www/myapp/static/
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;           # Don't log static file access
    }

    # Alternative: alias (when URL path ≠ file path)
    location /assets/ {
        alias /opt/myapp/dist/assets/;  # Note: trailing slash required
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA build files
    location / {
        root /var/www/myapp/build;
        try_files $uri $uri/ /index.html;

        # Cache static assets aggressively
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            access_log off;
        }

        # Don't cache HTML (it references hashed assets)
        location ~* \.html$ {
            expires -1;
            add_header Cache-Control "no-store, no-cache, must-revalidate";
        }
    }
}
```

### `root` vs `alias`

```nginx
# root: appends the location path
location /images/ {
    root /var/www;
    # Request: /images/cat.jpg
    # Serves:  /var/www/images/cat.jpg
}

# alias: replaces the location path
location /images/ {
    alias /opt/media/photos/;
    # Request: /images/cat.jpg
    # Serves:  /opt/media/photos/cat.jpg
}
```

### Gzip Compression

```nginx
http {
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;          # 1-9, 6 is good balance
    gzip_min_length 256;        # Don't compress tiny files
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/rss+xml
        image/svg+xml;
    # Note: don't gzip images (jpg/png) — they're already compressed
}
```

---

## 10 — Security Headers

```nginx
# /etc/nginx/snippets/security-headers.conf

# Prevent clickjacking (don't allow your site in iframes)
add_header X-Frame-Options "SAMEORIGIN" always;

# Prevent MIME-type sniffing attacks
add_header X-Content-Type-Options "nosniff" always;

# XSS protection (legacy browsers)
add_header X-XSS-Protection "1; mode=block" always;

# Content Security Policy (restrict resource loading)
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com;" always;

# HSTS — Force HTTPS for 1 year (careful: hard to undo!)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

# Don't leak referrer to external sites
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Permissions Policy (disable unused browser features)
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

### What Each Header Prevents

| Header | Prevents | Attack Type |
|--------|----------|-------------|
| X-Frame-Options | Your site loaded in malicious iframe | Clickjacking |
| X-Content-Type-Options | Browser guessing file types | MIME confusion |
| X-XSS-Protection | Reflected XSS (legacy) | Cross-site scripting |
| Content-Security-Policy | Loading scripts from other domains | XSS, data injection |
| HSTS | Downgrade from HTTPS to HTTP | Man-in-the-middle |
| Referrer-Policy | Leaking URLs to third parties | Information disclosure |

```nginx
# Include in your server block
server {
    include /etc/nginx/snippets/security-headers.conf;
    # ...
}
```

---

## 11 — Rate Limiting

### Configuration

```nginx
# Define rate limit zones (in http context)
http {
    # General API rate limit: 10 requests/second per IP
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # Login endpoint: 5 requests/minute per IP (brute force protection)
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

    # Global rate limit: 100 requests/second per IP
    limit_req_zone $binary_remote_addr zone=global:10m rate=100r/s;
}

server {
    # Apply global rate limit
    limit_req zone=global burst=50 nodelay;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:3000;
    }

    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://localhost:3000;
    }
}
```

### Parameters Explained

| Parameter | Meaning |
|-----------|---------|
| `zone=api:10m` | Name "api", 10MB shared memory (~160K IPs) |
| `rate=10r/s` | 10 requests per second average |
| `burst=20` | Allow 20 requests in a burst before limiting |
| `nodelay` | Don't queue excess requests, reject immediately |

### Custom Error Response

```nginx
# Return JSON error for API rate limits
limit_req_status 429;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    error_page 429 = @rate_limited;
    proxy_pass http://localhost:3000;
}

location @rate_limited {
    default_type application/json;
    return 429 '{"error": "Too many requests", "retry_after": 1}';
}
```

---

## 12 — Load Balancing

### Algorithms

```nginx
# Round-Robin (default) — equal distribution
upstream backend {
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
    server 10.0.1.12:3000;
}

# Least Connections — send to least busy
upstream backend {
    least_conn;
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
    server 10.0.1.12:3000;
}

# IP Hash — same client always hits same backend (sticky sessions)
upstream backend {
    ip_hash;
    server 10.0.1.10:3000;
    server 10.0.1.11:3000;
    server 10.0.1.12:3000;
}

# Weighted — some servers get more traffic
upstream backend {
    server 10.0.1.10:3000 weight=3;  # Gets 3x traffic
    server 10.0.1.11:3000 weight=1;
    server 10.0.1.12:3000 weight=1;
}
```

### Health Checks and Failover

```nginx
upstream backend {
    server 10.0.1.10:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:3000 backup;  # Only used when others are down
}
# max_fails=3: mark as down after 3 failed requests
# fail_timeout=30s: wait 30s before trying again
```

### When to Use NGINX LB vs AWS ALB

| Feature | NGINX LB | AWS ALB |
|---------|----------|---------|
| Cost | Free (you manage) | Pay per hour + traffic |
| SSL termination | ✅ | ✅ |
| Health checks | Basic | Advanced (path, codes) |
| Auto-scaling integration | ❌ Manual | ✅ Native |
| WebSocket | ✅ | ✅ |
| Sticky sessions | ✅ ip_hash | ✅ Cookie-based |
| Management | You maintain | AWS manages |

**Rule of thumb:** Use NGINX LB for multiple processes on one server. Use AWS ALB for multiple servers.

---

## 13 — Complete Production Configuration

```nginx
# /etc/nginx/sites-available/myapp.conf

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# Upstream (if multiple backend processes)
upstream app_backend {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    keepalive 32;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    # SSL
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" always;

    # Logging
    access_log /var/log/nginx/myapp-access.log;
    error_log /var/log/nginx/myapp-error.log warn;

    # Static files (React/Vue build)
    location / {
        root /var/www/myapp/build;
        try_files $uri $uri/ /index.html;

        # Cache hashed assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }

    # API reverse proxy
    location /api/ {
        limit_req zone=api burst=20 nodelay;

        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;

        # Don't pass along these headers from backend
        proxy_hide_header X-Powered-By;
    }

    # Auth endpoints — stricter rate limiting
    location /api/auth/ {
        limit_req zone=login burst=3 nodelay;

        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws/ {
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    # Health check (no rate limit, no logging)
    location = /health {
        access_log off;
        proxy_pass http://app_backend;
    }

    # Block common attack paths
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    location ~ ^/(wp-admin|wp-login|xmlrpc|phpmyadmin) {
        return 444;
    }
}
```

---

## 14 — Interview Callouts

> **"Why would you put NGINX in front of a Node.js application?"**
>
> Five reasons: (1) SSL termination — NGINX handles TLS much more efficiently than Node.js. (2) Static files — NGINX uses sendfile() for zero-copy serving, orders of magnitude faster than Express.static(). (3) Rate limiting and security headers — implemented at the infrastructure level, not in app code. (4) Connection management — NGINX's event loop handles thousands of idle connections without overhead, whereas each connection to Node.js occupies memory in the V8 heap. (5) Future flexibility — you can add load balancing, caching, or additional backends without changing your app.

> **"How does NGINX handle 10,000 concurrent connections?"**
>
> Event-driven architecture. Instead of spawning a thread per connection (like Apache), NGINX uses an event loop with non-blocking I/O. Each worker process can handle thousands of connections using epoll/kqueue. It only consumes resources when there's actual I/O to process. A typical 4-core server can handle 40,000+ concurrent connections with NGINX.

---

## 15 — "What Would Go Wrong If..." Scenarios

### No SSL Termination

**Scenario:** Your Node.js app handles TLS directly.

**What goes wrong:**
- Every Node.js process burns CPU on crypto (can't use sendfile)
- Certificate renewal requires app restart
- Must manage certs in app code
- No session caching between requests
- Performance drops 30-50% under load

### Missing X-Forwarded-For

```nginx
# ❌ Missing this line:
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

**What goes wrong:**
- `req.ip` in Express always shows `127.0.0.1`
- Rate limiting per-IP doesn't work (treats all traffic as one user)
- Geolocation fails
- Audit logs are useless (can't identify clients)
- Fraud detection is blind

### No Rate Limiting During Bot Attack

**Scenario:** A competitor runs a scraping bot hitting your API 1000 req/s.

**What goes wrong:**
- Backend overwhelmed, legitimate users get 503 errors
- Database connections exhausted
- Server runs out of memory from queued connections
- You're paying for the traffic (AWS bandwidth charges)
- Eventual crash → downtime for everyone

### Missing try_files for SPA

```nginx
# ❌ Without try_files
location / {
    root /var/www/build;
}
```

**What goes wrong:**
- `https://app.com/dashboard` → 404 (no physical file exists)
- `https://app.com/users/123` → 404
- Only `https://app.com/` works (because index.html exists there)
- Users can't bookmark or refresh any route except the homepage

---

## 16 — Tech Lead Decision: NGINX vs Caddy vs Traefik

| Feature | NGINX | Caddy | Traefik |
|---------|-------|-------|---------|
| **Auto HTTPS** | ❌ Manual certbot | ✅ Automatic | ✅ Automatic |
| **Config format** | Custom syntax | Caddyfile (simple) | YAML/TOML |
| **Performance** | 🟢 Fastest | 🟡 Good | 🟡 Good |
| **Docker-native** | ⚠️ Manual | ⚠️ Manual | ✅ Auto-discovery |
| **Learning curve** | 🔴 Steep | 🟢 Easy | 🟡 Medium |
| **Community/docs** | 🟢 Massive | 🟡 Growing | 🟡 Good |
| **Enterprise features** | NGINX Plus ($$$) | Caddy Enterprise | Traefik Enterprise |
| **Best for** | Any production server | Simple sites, dev | Kubernetes, Docker |

**Choose NGINX when:** Maximum performance needed, team already knows it, complex routing rules, non-containerized workloads.

**Choose Caddy when:** Simplicity is priority, auto-HTTPS is killer feature, smaller team, modern Go-based stack.

**Choose Traefik when:** Heavy Docker/Kubernetes usage, services come and go dynamically, need auto-discovery of backends.

---

## 17 — Performance Tuning

```nginx
# /etc/nginx/nginx.conf — Performance-optimized

worker_processes auto;                    # One per CPU core
worker_rlimit_nofile 65535;              # Max open files per worker

events {
    worker_connections 4096;              # Connections per worker
    multi_accept on;                      # Accept multiple connections at once
    use epoll;                            # Linux-optimized event method
}

http {
    # File serving optimization
    sendfile on;                          # Kernel-level file transfer
    tcp_nopush on;                        # Send headers and file in one packet
    tcp_nodelay on;                       # Disable Nagle's algorithm

    # Keepalive
    keepalive_timeout 65;                 # Close idle connections after 65s
    keepalive_requests 1000;              # Max requests per keepalive connection

    # Buffers
    client_body_buffer_size 16k;          # POST body buffer
    client_header_buffer_size 1k;         # Header buffer
    client_max_body_size 50m;             # Max upload size
    large_client_header_buffers 4 8k;     # Large headers

    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    send_timeout 10;

    # Open file cache
    open_file_cache max=65535 inactive=20s;
    open_file_cache_valid 30s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_types
        text/plain text/css text/xml text/javascript
        application/json application/javascript application/xml
        application/rss+xml image/svg+xml;
}
```

---

## 18 — Debugging Tips

### Essential Commands

```bash
# Test configuration (ALWAYS do this before reload)
sudo nginx -t
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful

# Reload without downtime
sudo systemctl reload nginx

# Full restart (brief downtime)
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx

# View error log in real-time
sudo tail -f /var/log/nginx/error.log

# View access log
sudo tail -f /var/log/nginx/access.log

# Check which config is loaded
nginx -V 2>&1 | grep "configure arguments"

# List all included config files
nginx -T 2>&1 | grep "# configuration file"
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `502 Bad Gateway` | Backend not running | Start pm2/app |
| `504 Gateway Timeout` | Backend too slow | Increase proxy_read_timeout |
| `413 Request Entity Too Large` | Upload exceeds limit | Increase client_max_body_size |
| `403 Forbidden` | File permissions wrong | chown/chmod on files |
| `404 Not Found` | Wrong root/alias path | Check file paths |
| `[emerg] bind() failed` | Port already in use | Kill other process or change port |

### Debugging Proxy Issues

```bash
# Test if backend is reachable from server
curl -v http://localhost:3000/health

# Check what NGINX is sending to backend
# Add to location block temporarily:
proxy_set_header X-Debug "true";
# Then check your app's received headers

# Enable debug logging (temporary!)
error_log /var/log/nginx/error.log debug;
# ⚠️ This generates MASSIVE logs — disable after debugging
```

---

## 19 — Key Takeaways

1. **NGINX is a reverse proxy first** — it protects your backend from direct internet exposure
2. **Event-driven architecture** — handles 10K+ connections with minimal resources
3. **Configuration hierarchy matters** — server_name matching, location priority order
4. **SSL termination in NGINX** — backend stays simple, certs managed in one place
5. **Static files belong in NGINX** — 10x faster than serving from your app
6. **Security headers are non-negotiable** — one config snippet protects everything
7. **Rate limiting prevents abuse** — different zones for different endpoints
8. **Always `nginx -t` before reload** — one typo takes down all sites
9. **`try_files` is critical for SPAs** — without it, refreshing any route 404s
10. **Logs are your first debugging tool** — access.log and error.log tell you everything
