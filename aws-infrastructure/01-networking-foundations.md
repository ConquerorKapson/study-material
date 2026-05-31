---
title: "Phase 1 — Networking Foundations"
description: "How the internet actually works — DNS, TCP/IP, ports, protocols. The mental model everything else builds on."
order: 1
---

# Phase 1 — Networking Foundations

> **Category:** Infrastructure · **Difficulty:** Beginner → Intermediate · **Related:** VPC · Security Groups · DNS

---

## TLDR

Every internet interaction is: **DNS resolves domain → TCP connects to IP:port → HTTP request/response flows**. Ports are apartment numbers in a building (IP is the building address). Public IPs are internet-routable; private IPs are local-only.

---

## 01 — The Real-World Analogy

Imagine sending a letter:

| Internet Concept | Letter Analogy |
|-----------------|----------------|
| IP Address | Street address of the building |
| Port | Apartment number inside building |
| DNS | Phone book — name → address |
| TCP | Registered mail — guaranteed delivery |
| HTTP | The letter content + envelope format |
| Router | Post offices along the route |

Your server is an apartment building. SSH lives in apt 22, website in apt 443, backend in apt 3000. Security Groups are the doorman checking a list.

---

## 02 — How the Internet Actually Works

When you type `https://myapp.com/dashboard`:

```
┌─────────────────────────────────────────────────────────┐
│ 1. DNS Resolution                                        │
│    Browser → "IP of myapp.com?" → DNS → 54.23.1.100     │
├─────────────────────────────────────────────────────────┤
│ 2. TCP Three-Way Handshake                               │
│    SYN → SYN-ACK → ACK (connection open to port 443)    │
├─────────────────────────────────────────────────────────┤
│ 3. TLS Handshake                                         │
│    Negotiate encryption, verify certificate              │
├─────────────────────────────────────────────────────────┤
│ 4. HTTP Request                                          │
│    GET /dashboard HTTP/1.1                               │
├─────────────────────────────────────────────────────────┤
│ 5. HTTP Response                                         │
│    200 OK + HTML body                                    │
└─────────────────────────────────────────────────────────┘
```

> **Key Insight:** Every request — API call, image load, WebSocket — follows this pattern. Once it's in your bones, debugging becomes systematic.

---

## 03 — TCP/IP Deep Dive

### The Three-Way Handshake

```
Client                    Server
  │── SYN (seq=100) ──────►│   "I want to talk"
  │◄── SYN-ACK (seq=300, ──│   "Got it, here's mine"
  │     ack=101)            │
  │── ACK (ack=301) ──────►│   "Connected!"
  │◄════ DATA ════════════►│
```

**Why three steps?** Both sides must propose AND acknowledge sequence numbers. Two steps wouldn't confirm the server's number was received.

### TCP vs UDP

| | TCP | UDP |
|--|-----|-----|
| **Delivery** | Guaranteed | Best-effort |
| **Order** | In-sequence | No guarantee |
| **Speed** | Slower (overhead) | Faster (fire-and-forget) |
| **Use** | HTTP, SSH, DB, files | Video, gaming, DNS, VoIP |
| **Connection** | Handshake required | Connectionless |

> **Real-world:** Web APIs = TCP (every byte matters). Video calls = UDP (dropped frame beats frozen stream).

### What TCP Guarantees

- **Reliable delivery** — retransmits lost packets
- **Ordering** — reassembles in sequence
- **Flow control** — sender won't overwhelm receiver
- **Congestion control** — won't overwhelm the network

---

## 04 — Ports: The Apartment Numbers

A port is a 16-bit number (0–65535) identifying a service on a machine.

### Ports You Must Know

| Port | Service | Notes |
|------|---------|-------|
| 22 | SSH | Remote terminal |
| 80 | HTTP | Unencrypted web |
| 443 | HTTPS | Encrypted web |
| 53 | DNS | Name resolution |
| 3306 | MySQL | Database |
| 5432 | PostgreSQL | Database |
| 6379 | Redis | Cache |
| 27017 | MongoDB | Database |
| 3000/8000 | App servers | Your backend |

### How It Works

When Node.js does `app.listen(3000)` → OS routes all TCP packets for port 3000 to that process. Only ONE process per port (EADDRINUSE = something's already there).

### Ephemeral Ports

Your browser ALSO uses a port (random high number like 52847). Full connection = `source_ip:source_port ↔ dest_ip:dest_port`.

---

## 05 — Public vs Private IPs

| Type | Internet Routable? | Example | Assigned by |
|------|-------------------|---------|-------------|
| **Public** | ✅ Yes | 54.23.1.100 | ISP / AWS |
| **Private** | ❌ No | 10.0.1.42 | You / VPC |

### Private Ranges (RFC 1918)

| Range | CIDR | Common Use |
|-------|------|-----------|
| 10.0.0.0 – 10.255.255.255 | 10.0.0.0/8 | AWS VPCs |
| 172.16.0.0 – 172.31.255.255 | 172.16.0.0/12 | Corporate |
| 192.168.0.0 – 192.168.255.255 | 192.168.0.0/16 | Home routers |

### In AWS Context

- **EC2:** Has both — private IP (VPC internal) + public IP (internet-facing)
- **RDS:** Only private IP — intentionally unreachable from internet
- **Security Groups:** Reference private IPs and SG IDs, not public IPs

---

## 06 — DNS Deep Dive

### Resolution Flow

```
Browser cache → OS cache → Router cache → MISS!
                    ↓
Recursive Resolver (8.8.8.8)
  ├→ Root: "Who handles .com?" → .com TLD
  ├→ .com TLD: "Who handles myapp.com?" → ns1.cloudflare.com
  └→ Cloudflare: "A record: 54.23.1.100, TTL: 300"

Cached for 300s. Next request skips everything.
```

### Records That Matter

| Record | Maps | When Used |
|--------|------|-----------|
| **A** | Domain → IPv4 | Point domain to server |
| **CNAME** | Domain → Domain | Aliases, CDN |
| **MX** | Domain → Mail | Email setup |
| **TXT** | Domain → Text | Verification, SPF |
| **NS** | Domain → Nameserver | Delegating to Cloudflare |

### TTL Strategy

- **Before migration:** Lower to 60s (24h in advance)
- **Stable production:** 3600s or higher
- **During incident:** Can't change — old TTL still cached

---

## 07 — HTTP: Request/Response Cycle

### Request Anatomy

```http
GET /api/users/123 HTTP/1.1
Host: myapp.com
Authorization: Bearer eyJhbGc...
Accept: application/json
```

### Response Anatomy

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=3600

{"id": 123, "name": "Alice"}
```

### Status Codes to Know Cold

| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Success |
| 201 | Created | POST success |
| 301 | Moved Permanently | HTTP→HTTPS redirect |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | "Who are you?" (not authenticated) |
| 403 | Forbidden | "You can't do this" (not authorized) |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Server Error | Your code crashed |
| 502 | Bad Gateway | Upstream server down |
| 503 | Service Unavailable | Server overloaded |
| 504 | Gateway Timeout | Upstream too slow |

> **Interview tip:** 401 vs 403 — 401 = identity unknown, 403 = identity known but insufficient permissions.

---

## 08 — The Complete Flow (Everything Together)

```
User types: https://myapp.com/api/users

1. DNS:  myapp.com → 104.16.x.x (Cloudflare)
2. TCP:  Connect to 104.16.x.x:443
3. TLS:  Encrypt with Cloudflare
4. HTTP: GET /api/users → Cloudflare
5. Cloudflare: cache miss → forward to origin
6. TCP:  Cloudflare → 54.23.1.100:443 (EC2)
7. TLS:  Cloudflare ↔ NGINX
8. NGINX: /api/* → proxy to localhost:3000
9. Backend: query RDS (10.0.2.15:5432, private)
10. Response: RDS → Backend → NGINX → Cloudflare → User

Total: ~100-300ms
```

---

## 🧠 Quick Recall

1. What are the 5 steps when you type a URL?
2. Why does TCP need THREE steps (not two)?
3. Difference between port 80 and 443?
4. Why can't you reach `10.0.x.x` from the internet?
5. What does TTL control in DNS?
6. What's an ephemeral port?

---

## 🎯 Interview Q&A

**Q: What happens when you type google.com and press Enter?**

A: (Walk through systematically)
1. DNS resolution: browser cache → OS → resolver → root → TLD → authoritative → IP returned
2. TCP handshake: SYN → SYN-ACK → ACK to port 443
3. TLS handshake: cipher negotiation, certificate verification, session key exchange
4. HTTP request: GET / with headers
5. Server processes, returns HTML response
6. Browser parses HTML, fetches sub-resources (CSS, JS, images) — each triggers own cycle
7. Render: DOM → CSSOM → Layout → Paint

**Q: TCP vs UDP — when to choose each?**

A: TCP when every byte matters (web, APIs, DB, files). UDP when speed > perfection (live video, gaming, DNS). Most backend work = TCP.

**Q: Can two services share a port?**

A: No — one process per IP:port. EADDRINUSE means conflict. Exception: SO_REUSEPORT on Linux (kernel load-balances across processes).

**Q: Why does HTTPS use 443 not 80?**

A: Historical — port 80 existed for plaintext HTTP. TLS needed a separate port so servers could distinguish without content inspection. Today port 80 just 301-redirects to 443.

**Q: What's the maximum number of TCP connections a server can handle?**

A: Theoretical limit = ~2 billion (based on source IP × source port combinations). Practical limit = OS file descriptors, memory, CPU. A well-tuned server handles 100K+ concurrent connections (C10K/C10M problem).

---

## 🤔 Brainstorming Questions

1. **If DNS disappeared overnight**, how would the internet work? What's the minimum you'd need to replace it?

2. **Why are private IP ranges necessary** when IPv6 gives everyone a public address? (Think security, not just addressing.)

3. **If TCP guarantees delivery, why do requests fail?** At what layer does failure occur?

4. **Could you run PostgreSQL over HTTPS (port 443)?** What would you gain/lose vs dedicated port 5432?

5. **Design a simpler internet stack** — would you merge DNS+TCP+TLS+HTTP into one layer? (Hint: QUIC does something like this.)

6. **Why is 3-way handshake needed and not 2-way?** What attack does the third step prevent? (SYN flood)

---

*Next: [Phase 2 — VPC, Subnets, Security Groups](/aws-infrastructure/02-vpc-subnets-security-groups)*
