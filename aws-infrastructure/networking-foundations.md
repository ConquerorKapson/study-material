---
title: "Networking Foundations — How the Internet Actually Works"
description: "TCP/IP, DNS, ports, protocols, and the mental model every engineer needs before touching cloud infrastructure."
order: 1
---

# Networking Foundations — How the Internet Actually Works

> **Category:** AWS Infrastructure · **Difficulty:** Beginner · **Related:** TCP/IP · DNS · HTTP · Ports

---

## 01 — TLDR

- The internet is a layered system: DNS resolves names → TCP establishes reliable connections → HTTP carries your data
- Every network communication boils down to an **IP address + port number** (a "socket")
- DNS is the phonebook of the internet — it translates human-readable names to machine-readable IPs
- TCP guarantees delivery (three-way handshake), UDP prioritizes speed (fire-and-forget)
- Private IPs (10.x, 172.16-31.x, 192.168.x) exist behind NAT — your router translates them to one public IP
- HTTP status codes tell you what happened: 2xx = success, 3xx = redirect, 4xx = your fault, 5xx = server's fault
- Understanding this stack is **non-negotiable** for cloud engineering — every AWS service sits on top of it

**Elevator pitch:** If you can't explain how a packet travels from a browser to a server, you'll never truly understand VPCs, load balancers, or security groups. This is the foundation everything else rests on.

---

## 02 — How the Internet Works

Think of the internet like the postal system:

| Postal System | Internet Equivalent |
|---|---|
| Your street address | IP Address |
| Apartment number | Port Number |
| ZIP code routing | DNS Resolution |
| Certified mail (signature required) | TCP |
| Dropping a flyer in a mailbox | UDP |
| The postal sorting facility | Router |
| Envelope | Packet |

### The Journey of a Single Request

When you type `https://google.com` and press Enter, here's what happens:

```
1. DNS Resolution    → "What's google.com's IP?" → 142.250.80.46
2. TCP Handshake     → "Hey server, can we talk?" → SYN/SYN-ACK/ACK
3. TLS Handshake     → "Let's encrypt this conversation" → Certificate exchange
4. HTTP Request      → "GET / HTTP/1.1" → Your browser asks for the page
5. HTTP Response     → "200 OK" + HTML content → Server sends the page back
6. Rendering         → Browser parses HTML, fetches CSS/JS/images (repeat steps 1-5!)
```

Each of these steps involves multiple network hops through routers, switches, and cables spanning continents. A single Google search might traverse 15-20 network devices.

### The Packet's Physical Journey

```
Your laptop → WiFi router → ISP modem → ISP backbone →
Internet Exchange Point (IXP) → Destination ISP →
Data center switch → Server NIC → Application
```

> **Interview Callout:** "What happens when you type a URL in the browser?" is the most classic networking interview question. A complete answer covers DNS, TCP, TLS, HTTP, and rendering. The depth of your answer signals your seniority level.

---

## 03 — The TCP/IP Model

The internet runs on a **4-layer model** (not 7 — that's OSI, which is more academic):

```
┌─────────────────────────────────────────┐
│  Layer 4: APPLICATION                    │
│  HTTP, HTTPS, FTP, SSH, DNS, SMTP        │
│  "What are we saying?"                   │
├─────────────────────────────────────────┤
│  Layer 3: TRANSPORT                      │
│  TCP, UDP                                │
│  "How do we guarantee delivery?"         │
├─────────────────────────────────────────┤
│  Layer 2: INTERNET                       │
│  IP, ICMP, ARP                           │
│  "Where are we sending it?"              │
├─────────────────────────────────────────┤
│  Layer 1: NETWORK ACCESS                 │
│  Ethernet, WiFi, Fiber                   │
│  "How do bits physically travel?"        │
└─────────────────────────────────────────┘
```

### What Each Layer Does

**Application Layer** — This is where your code lives. When you make an HTTP request, write to a database, or send an email — you're operating here. You don't care about packets or IPs; you just say "GET me this webpage."

**Transport Layer** — Ensures data gets there reliably (TCP) or quickly (UDP). Handles port numbers, flow control, and retransmission. Think of it as the "reliability guarantee" layer.

**Internet Layer** — Handles addressing and routing. IP addresses live here. Routers operate at this layer, making decisions about which path a packet should take.

**Network Access Layer** — The physical stuff. Ethernet cables, WiFi signals, fiber optics. Converts data into electrical signals, light pulses, or radio waves.

### TCP/IP vs OSI (Brief Comparison)

| OSI (7 layers) | TCP/IP (4 layers) | Notes |
|---|---|---|
| Application | Application | OSI splits this into 3 (App/Presentation/Session) |
| Presentation | Application | Encoding, encryption |
| Session | Application | Connection management |
| Transport | Transport | Same concept |
| Network | Internet | Same concept |
| Data Link | Network Access | OSI splits physical into 2 |
| Physical | Network Access | Cables, signals |

> **Tech Lead insight:** In practice, nobody designs systems thinking about the OSI model. The TCP/IP model is what matters. But know OSI for interviews — some interviewers expect it.

---

## 04 — DNS Resolution

DNS (Domain Name System) is the phonebook of the internet. It translates `google.com` into `142.250.80.46` because humans are terrible at remembering numbers.

### The DNS Hierarchy

```
                    . (Root)
                   /    \
               .com    .org    .net    .io
              /    \
         google   amazon   github
        /     \
      www    mail    maps
```

### The Full Resolution Process

When you look up `www.example.com`, here's what happens:

```
┌──────────┐         ┌──────────────────┐
│ Your PC  │────────▶│ Recursive Resolver│ (Usually your ISP or 8.8.8.8)
└──────────┘         └────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌───────────────┐    ┌─────────────────────┐
│ Root Server  │    │  TLD Server   │    │ Authoritative Server │
│ "I know who  │    │ "I know who   │    │ "Here's the IP:     │
│  handles     │    │  handles      │    │  93.184.216.34"     │
│  .com"       │    │  example.com" │    │                     │
└──────────────┘    └───────────────┘    └─────────────────────┘
```

**Step by step:**
1. Browser checks its **local cache** — "Have I looked this up recently?"
2. OS checks `/etc/hosts` (or Windows hosts file) — hardcoded overrides
3. OS asks the **recursive resolver** (your ISP's DNS or 8.8.8.8)
4. Recursive resolver checks its **cache** — serves billions of users, likely has it
5. If not cached: asks a **root server** (13 clusters globally) — "Who handles .com?"
6. Root says: "Ask the .com TLD server at 192.5.6.30"
7. Resolver asks **.com TLD server** — "Who handles example.com?"
8. TLD says: "Ask the authoritative server at ns1.example.com"
9. Resolver asks **authoritative server** — "What's the IP for www.example.com?"
10. Authoritative responds: "93.184.216.34, TTL: 300 seconds"
11. Resolver **caches** the answer and returns it to your OS
12. OS caches it, browser caches it — next request skips all this

### TTL (Time To Live)

TTL tells caches how long an answer is valid:

| TTL Value | Use Case | Trade-off |
|---|---|---|
| 60 seconds | Failover, blue-green deployments | More DNS queries, faster propagation |
| 300 seconds | Standard web applications | Good balance |
| 3600 seconds | Stable services | Fewer queries, slow changes |
| 86400 seconds | Almost-never-changing records | Minimal load, very slow updates |

> **What would go wrong:** DNS Cache Poisoning — An attacker injects false DNS records into a resolver's cache. Now everyone using that resolver gets sent to the attacker's server instead of the real one. This is why DNSSEC exists.

---

## 05 — HTTP Request/Response Cycle

HTTP (Hypertext Transfer Protocol) is the language browsers and servers speak. It's a **request-response** protocol — you ask, server answers.

### HTTP Methods

| Method | Purpose | Idempotent? | Safe? | Body? |
|---|---|---|---|---|
| GET | Retrieve data | ✅ | ✅ | ❌ |
| POST | Create resource | ❌ | ❌ | ✅ |
| PUT | Replace resource entirely | ✅ | ❌ | ✅ |
| PATCH | Partial update | ❌ | ❌ | ✅ |
| DELETE | Remove resource | ✅ | ❌ | ❌ |
| HEAD | GET without body (check headers) | ✅ | ✅ | ❌ |
| OPTIONS | What methods are allowed? (CORS preflight) | ✅ | ✅ | ❌ |

### A Real HTTP Request

```http
GET /api/users/42 HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
User-Agent: Mozilla/5.0
Connection: keep-alive
```

### A Real HTTP Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 128
Cache-Control: max-age=60
X-Request-Id: abc-123-def

{
  "id": 42,
  "name": "Santiago",
  "email": "santiago@example.com",
  "role": "engineer"
}
```

### Status Codes — The Cheat Sheet

| Range | Meaning | Common Codes |
|---|---|---|
| 🟢 2xx | **Success** — it worked | 200 OK, 201 Created, 204 No Content |
| 🟡 3xx | **Redirect** — look elsewhere | 301 Moved Permanently, 302 Found, 304 Not Modified |
| 🔴 4xx | **Client Error** — you messed up | 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests |
| 🔴 5xx | **Server Error** — we messed up | 500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout |

### Key Headers You Should Know

| Header | Direction | Purpose |
|---|---|---|
| `Content-Type` | Both | What format is the body? (application/json, text/html) |
| `Authorization` | Request | Authentication token |
| `Cache-Control` | Response | How long to cache this response |
| `X-Request-Id` | Both | Trace a request through microservices |
| `Retry-After` | Response | When to retry after a 429 or 503 |
| `Accept` | Request | What formats the client wants back |

---

## 06 — Ports and Protocols

### What Is a Port?

Think of an IP address as a building's street address. A **port** is the apartment number. One server (one IP) can run many services — each on a different port.

```
IP Address:   203.0.113.50        ← "The building"
Port 80:      Web server (HTTP)   ← "Apartment 80"
Port 443:     Web server (HTTPS)  ← "Apartment 443"
Port 22:      SSH daemon           ← "Apartment 22"
Port 5432:    PostgreSQL           ← "Apartment 5432"
```

A **socket** is the full address: `203.0.113.50:443` — building + apartment.

### Well-Known Ports

| Port | Protocol | Service | Remember It As |
|---|---|---|---|
| 20/21 | FTP | File transfer | "Old school file sharing" |
| 22 | SSH | Secure shell | "Encrypted remote access" |
| 25 | SMTP | Email sending | "Outgoing mail" |
| 53 | DNS | Name resolution | "The phonebook" |
| 80 | HTTP | Web (unencrypted) | "The old web" |
| 443 | HTTPS | Web (encrypted) | "The modern web" |
| 3306 | MySQL | Database | "MySQL default" |
| 5432 | PostgreSQL | Database | "Postgres default" |
| 6379 | Redis | Cache/queue | "Redis default" |
| 8080 | HTTP Alt | Dev servers, proxies | "The developer port" |
| 27017 | MongoDB | Document database | "Mongo default" |

### Port Ranges

| Range | Name | Who Uses It |
|---|---|---|
| 0-1023 | Well-known ports | OS-level services (requires root/admin) |
| 1024-49151 | Registered ports | Applications (MySQL, Redis, etc.) |
| 49152-65535 | Dynamic/Ephemeral | Your OS assigns these for outgoing connections |

> **What would go wrong:** Port Exhaustion — Every outgoing connection uses an ephemeral port. If your app opens thousands of connections without closing them (connection leak), you run out of ports. The system can't make new connections. Symptoms: "Cannot assign requested address" errors.

---

## 07 — Public vs Private IPs

### Private IP Ranges (RFC 1918)

These IPs **never** appear on the public internet:

| Range | CIDR | Available IPs | Typical Use |
|---|---|---|---|
| 10.0.0.0 – 10.255.255.255 | 10.0.0.0/8 | 16,777,216 | Large enterprises, AWS VPCs |
| 172.16.0.0 – 172.31.255.255 | 172.16.0.0/12 | 1,048,576 | Medium networks |
| 192.168.0.0 – 192.168.255.255 | 192.168.0.0/16 | 65,536 | Home networks |

### NAT (Network Address Translation) — Explained Simply

Your home network has many devices (laptop, phone, TV, smart fridge) — each with a private IP (192.168.1.x). But your ISP gives you **one** public IP.

**NAT is the translator at your front door:**

```
┌─────────────── Your Home ───────────────┐
│                                          │
│  Laptop: 192.168.1.10                    │
│  Phone:  192.168.1.11       ┌────────┐  │     ┌──────────┐
│  TV:     192.168.1.12  ────▶│ Router │──┼────▶│ Internet │
│                              │ (NAT)  │  │     │          │
│  All share one public IP:    │203.0.  │  │     │ Sees:    │
│                              │113.50  │  │     │ 203.0.   │
│                              └────────┘  │     │ 113.50   │
└──────────────────────────────────────────┘     └──────────┘
```

**How NAT works:**
1. Your laptop (192.168.1.10) sends a request to google.com
2. Router replaces source IP: `192.168.1.10:54321` → `203.0.113.50:54321`
3. Google responds to `203.0.113.50:54321`
4. Router checks its NAT table: "port 54321 = laptop"
5. Router forwards response to `192.168.1.10:54321`

### Why This Matters for AWS

In AWS:
- **Public subnets** have instances with public IPs (or Elastic IPs)
- **Private subnets** have instances with only private IPs (10.x.x.x)
- **NAT Gateway** = the router that lets private instances reach the internet for updates without being publicly accessible

---

## 08 — TCP vs UDP

### TCP (Transmission Control Protocol) — "Certified Mail"

TCP guarantees delivery. If a packet is lost, it's retransmitted. Data arrives in order.

**The Three-Way Handshake:**

```
Client                    Server
  │                         │
  │──── SYN ───────────────▶│  "Hey, want to talk?"
  │                         │
  │◀─── SYN-ACK ───────────│  "Sure, I'm ready too"
  │                         │
  │──── ACK ───────────────▶│  "Great, let's go!"
  │                         │
  │◀═══ DATA FLOWS ════════▶│  Connection established
```

**TCP Features:**
- ✅ Guaranteed delivery (retransmission)
- ✅ Ordered delivery (sequence numbers)
- ✅ Flow control (don't overwhelm the receiver)
- ✅ Congestion control (don't overwhelm the network)
- ❌ Higher latency (handshake overhead)
- ❌ More bandwidth (headers, ACKs)

### UDP (User Datagram Protocol) — "Dropping a Flyer"

UDP sends data and hopes for the best. No handshake, no guarantees, no ordering.

**UDP Features:**
- ✅ Low latency (no handshake)
- ✅ Low overhead (tiny headers)
- ✅ Supports multicast/broadcast
- ❌ No delivery guarantee
- ❌ No ordering guarantee
- ❌ No congestion control

### When to Use Which

| Use Case | Protocol | Why |
|---|---|---|
| Web browsing (HTTP/HTTPS) | TCP | Need every byte of HTML/CSS/JS |
| Email (SMTP) | TCP | Can't lose half an email |
| File transfer (FTP/SCP) | TCP | Files must be complete |
| Video streaming | UDP | A dropped frame is better than pausing |
| Online gaming | UDP | Old position data is worthless |
| VoIP (phone calls) | UDP | Slight garble > awkward silence |
| DNS queries | UDP (usually) | Single question/answer, fast |
| Database connections | TCP | Data integrity is paramount |

> **What would go wrong:** TCP SYN Flood — An attacker sends thousands of SYN packets but never completes the handshake (no ACK). The server keeps half-open connections in memory, eventually exhausting resources. This is a classic DDoS attack. Mitigation: SYN cookies, rate limiting, AWS Shield.

---

## 09 — Real-World Scenario: Tracing Every Network Hop

**Scenario:** A user in São Paulo types `https://www.google.com` and presses Enter.

```
Step 1: DNS Resolution (50-200ms first time, 0ms if cached)
├── Browser cache: miss
├── OS cache: miss
├── Router cache: miss
├── ISP recursive resolver (8.8.8.8):
│   ├── Cache hit! google.com → 142.250.80.46
│   └── Returns IP with TTL: 300s
└── Browser now knows: connect to 142.250.80.46:443

Step 2: TCP Three-Way Handshake (10-100ms depending on distance)
├── SYN → 142.250.80.46:443
├── SYN-ACK ← from Google's server
└── ACK → connection established

Step 3: TLS Handshake (adds 1-2 round trips)
├── ClientHello (supported ciphers, TLS version)
├── ServerHello + Certificate (Google's public key)
├── Client verifies certificate chain (trusted CA?)
├── Key exchange (generate shared session key)
└── Encrypted tunnel established

Step 4: HTTP Request
├── GET / HTTP/2
├── Host: www.google.com
├── Accept: text/html
└── (encrypted inside TLS tunnel)

Step 5: HTTP Response
├── 200 OK
├── Content-Type: text/html
├── ~100KB of HTML
└── Browser begins rendering

Step 6: Subresource Loading (parallel)
├── CSS files → repeat steps 1-5
├── JavaScript → repeat steps 1-5
├── Images → repeat steps 1-5
└── (HTTP/2 multiplexing: one connection, many requests)

Total time: 200-800ms (first visit), 50-100ms (cached)
```

### Physical Path

```
São Paulo → Undersea cable → Miami IX → US backbone →
Google data center (likely GRU airport region for Brazil) →
Response follows reverse path
```

---

## 10 — Interview Deep-Dive: "What Happens When You Type a URL?"

> **This is the canonical networking interview question. Here's the comprehensive answer:**

**DNS Phase:**
"First, the browser needs to resolve the domain name to an IP address. It checks its local cache, then the OS cache, then queries a recursive DNS resolver. If uncached, the resolver walks the DNS hierarchy: root servers → TLD servers → authoritative nameserver, getting the IP address."

**Connection Phase:**
"With the IP, the browser initiates a TCP connection via the three-way handshake — SYN, SYN-ACK, ACK. For HTTPS, this is followed by a TLS handshake where certificates are exchanged and a symmetric encryption key is negotiated."

**Request Phase:**
"The browser sends an HTTP GET request with headers including Host, Accept, User-Agent, and any cookies. The request travels through potentially many routers, each making forwarding decisions based on routing tables."

**Server Phase:**
"The server (often behind a load balancer) receives the request, processes it — possibly querying databases, caches, or other microservices — and generates an HTTP response with status code, headers, and body."

**Rendering Phase:**
"The browser receives the HTML, parses it into a DOM tree, discovers CSS and JS resources, fetches them in parallel (HTTP/2), constructs the CSSOM, executes JavaScript, and paints pixels to the screen."

**Tech Lead bonus points:** Mention CDNs (edge caching), connection reuse (keep-alive), HTTP/2 multiplexing, service workers, and browser preconnect hints.

---

## 11 — Tech Lead Decisions

### "When Would You Choose TCP vs UDP for a Microservice?"

| Factor | Choose TCP | Choose UDP |
|---|---|---|
| Data integrity critical | ✅ Financial transactions, user data | ❌ |
| Real-time requirements | ❌ Handshake adds latency | ✅ Live metrics, telemetry |
| Message ordering matters | ✅ Event sourcing, logs | ❌ |
| Small, stateless messages | ⚠️ Overhead is high | ✅ Health checks, heartbeats |
| Unreliable network | ✅ Built-in retransmission | ❌ Must build your own |
| Multicast needed | ❌ Point-to-point only | ✅ Service discovery |

**The pragmatic answer:** Use TCP for almost everything. Only reach for UDP when you have a specific, measured latency requirement and can handle application-level reliability. In microservices, gRPC (over TCP/HTTP2) covers 99% of cases.

### "How Do You Debug Network Issues in Production?"

```bash
# DNS issues
dig example.com                    # Query DNS directly
nslookup example.com               # Alternative DNS query
dig +trace example.com             # Trace full resolution path

# Connectivity issues
ping 10.0.1.50                     # Basic reachability (ICMP)
traceroute 10.0.1.50               # Show every hop
telnet 10.0.1.50 5432              # Test if specific port is open
nc -zv 10.0.1.50 5432              # Netcat port test

# TCP issues
ss -tlnp                           # Show listening ports (Linux)
netstat -an                        # Show all connections
tcpdump -i eth0 port 443           # Packet capture

# HTTP issues
curl -v https://api.example.com    # Verbose HTTP request
curl -I https://api.example.com    # Headers only
```

---

## 12 — "What Would Go Wrong If..." Scenarios

### Scenario 1: DNS Cache Poisoning

**What happens:** An attacker injects false records into a DNS resolver's cache.

**Impact:** All users of that resolver get directed to the attacker's server — potentially a phishing site that looks identical to the real one.

**Mitigation:**
- DNSSEC (cryptographic signatures on DNS records)
- DNS over HTTPS (DoH) or DNS over TLS (DoT)
- Short TTLs for sensitive domains
- Monitoring for unexpected DNS changes

### Scenario 2: Port Exhaustion

**What happens:** An application opens connections faster than it closes them (connection leak).

**Symptoms:** "Cannot assign requested address" errors, new connections fail, existing ones still work.

**Mitigation:**
- Connection pooling (reuse connections)
- Proper connection timeout and cleanup
- Monitor ephemeral port usage (`ss -s` on Linux)
- Increase ephemeral port range if needed (`net.ipv4.ip_local_port_range`)

### Scenario 3: TCP SYN Flood (DDoS)

**What happens:** Attacker sends millions of SYN packets from spoofed IPs. Server allocates memory for each half-open connection.

**Symptoms:** Server becomes unresponsive, legitimate connections time out.

**Mitigation:**
- SYN cookies (stateless SYN handling)
- Rate limiting at the firewall/load balancer
- AWS Shield / Cloudflare / Akamai (absorb the flood)
- Increase the SYN backlog queue

---

## 13 — Key Takeaways for Cloud Engineering

| Concept | Why It Matters in AWS |
|---|---|
| DNS | Route 53 is AWS's DNS service — you'll configure A records, CNAMEs, and routing policies |
| TCP/IP | Security Groups operate at the transport layer (TCP/UDP + port) |
| Ports | Every SG rule references ports — you must know which services use which ports |
| Public/Private IPs | VPC design revolves around public vs private subnets |
| NAT | NAT Gateways let private instances reach the internet for updates |
| HTTP | ALB routes based on HTTP path/headers — you must understand the protocol |

> **Final thought:** Every cloud architecture diagram you'll ever draw is just a visualization of networking concepts. Master these fundamentals and everything else — VPCs, load balancers, service meshes — becomes an application of what you already know.

---

*Next up: [VPC, Subnets, and Security Groups](./vpc-subnets-security-groups.md) — where we apply these networking fundamentals to build private cloud networks in AWS.*
