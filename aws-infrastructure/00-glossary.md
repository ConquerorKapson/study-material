---
title: "AWS Infrastructure Glossary"
description: "Quick-reference glossary of every infrastructure term — click any hyperlink from other articles to land here, then hit Back to resume."
order: 0
---

# AWS Infrastructure Glossary

> **Category:** Infrastructure · **Difficulty:** Reference · **Related:** All Phases

---

## How to Use This Page

Other articles link here when they use a complex term. Click the term → land at its definition → hit your browser's **Back button** to return exactly where you were.

---

## A

### API Gateway {#api-gateway}

A managed service that sits in front of your APIs. It handles routing, rate limiting, authentication, and request/response transformation. Think of it as a "smart receptionist" for your backend services.

### AMI (Amazon Machine Image) {#ami}

A snapshot of an EC2 instance's entire state — OS, installed software, configurations. Like a "template" you can stamp out new identical servers from. Create one before risky changes as your rollback safety net.

### Asymmetric Cryptography {#asymmetric-cryptography}

A system using **two mathematically linked keys**: a public key (shareable) and a private key (secret). Data encrypted with one can only be decrypted by the other. Used in SSH, HTTPS/TLS, and digital signatures.

### Auto Scaling Group (ASG) {#auto-scaling-group}

An AWS construct that automatically launches or terminates EC2 instances based on demand (CPU, request count, schedule). Works with a Load Balancer to distribute traffic across healthy instances.

### Availability Zone (AZ) {#availability-zone}

A physically separate data center within an AWS Region. Each AZ has independent power, cooling, and networking. Spreading resources across AZs protects against single-datacenter failures. Example: `ap-south-1a`, `ap-south-1b`.

---

## B

### Bcrypt {#bcrypt}

A password hashing algorithm designed to be **intentionally slow** (configurable via cost factor). This makes brute-force attacks impractical. Each hash includes a random salt, so identical passwords produce different hashes.

---

## C

### CDN (Content Delivery Network) {#cdn}

A globally distributed network of servers that cache your static content (JS, CSS, images) at locations close to users. A user in Mumbai gets served from a nearby CDN node instead of your origin server in US-East.

### CIDR (Classless Inter-Domain Routing) {#cidr}

A notation for IP address ranges. `10.0.0.0/16` means "all IPs from 10.0.0.0 to 10.0.255.255" (65,536 addresses). The number after `/` tells how many bits are fixed — smaller number = bigger range.

| CIDR | IPs Available | Use Case |
|------|--------------|----------|
| `/16` | 65,536 | Entire VPC |
| `/24` | 256 | Single subnet |
| `/32` | 1 | Single host |

### Connection Pooling {#connection-pooling}

Maintaining pre-opened database connections that are reused across requests. Opening a DB connection involves TCP handshake + auth + TLS — expensive to repeat thousands of times per second.

### CORS (Cross-Origin Resource Sharing) {#cors}

A browser security mechanism that blocks JavaScript from making requests to a different domain. Your backend must explicitly allow cross-origin requests via `Access-Control-Allow-Origin` headers.

### CSRF (Cross-Site Request Forgery) {#csrf}

An attack where a malicious site tricks your browser into making authenticated requests to another site. Mitigated with CSRF tokens — random values required in form submissions.

---

## D

### DDoS (Distributed Denial of Service) {#ddos}

An attack flooding your server with traffic so it can't serve legitimate users. Cloudflare/AWS Shield absorbs this at the edge before reaching your server.

### DNS (Domain Name System) {#dns}

The "phone book of the internet" — translates domain names (`google.com`) into IP addresses (`142.250.80.46`). Results are cached per TTL.

| Record Type | Purpose | Example |
|-------------|---------|---------|
| A | Domain → IPv4 | `example.com → 54.23.1.100` |
| AAAA | Domain → IPv6 | `example.com → 2001:db8::1` |
| CNAME | Domain → Domain | `www → example.com` |
| MX | Mail server | Email routing |
| TXT | Arbitrary text | SPF/DKIM verification |

---

## E

### Elastic IP {#elastic-ip}

A static public IPv4 address in AWS. Normally EC2 IPs change on stop/start. An Elastic IP stays fixed. Free while attached to running instance; charges if unattached.

### ELB (Elastic Load Balancer) {#elb}

Distributes incoming traffic across multiple EC2 instances. Types: ALB (Layer 7), NLB (Layer 4), CLB (legacy).

---

## G

### Gzip Compression {#gzip}

Compression reducing HTTP response sizes by 60-80% for text content. NGINX compresses on-the-fly before sending to clients.

---

## I

### IAM (Identity and Access Management) {#iam}

AWS's permission system. Controls who can do what to which resources. The security backbone of your AWS account.

### IGW (Internet Gateway) {#igw}

The "front door" of your VPC to the public internet. A public subnet's route table points `0.0.0.0/0` to the IGW.

### Instance Metadata Service {#instance-metadata}

A special endpoint (`http://169.254.169.254`) inside EC2 providing IAM credentials, instance info — no secrets on disk needed.

---

## J

### JWT (JSON Web Token) {#jwt}

A compact token format: `header.payload.signature`. Server signs with secret; clients can't tamper without invalidating signature. Used for stateless authentication.

---

## L

### Least Privilege {#least-privilege}

Every entity should have **only minimum permissions** needed. If your app reads one S3 bucket, the role should only allow `s3:GetObject` on that bucket.

---

## N

### NACL (Network Access Control List) {#nacl}

A **subnet-level** firewall. Unlike Security Groups (stateful), NACLs are **stateless** — must allow both inbound AND outbound explicitly.

### NAT Gateway {#nat-gateway}

Allows private subnet instances to make outbound internet requests without being reachable from the internet.

---

## O

### OAuth 2.0 {#oauth}

Authorization framework for third-party access (e.g., "Sign in with Google"). Key flow: redirect → authenticate → authorization code → access token.

---

## P

### pm2 {#pm2}

Production process manager for Node.js. Keeps app running after SSH disconnect, restarts on crash, handles clustering.

### Pre-signed URL {#presigned-url}

A temporary authenticated URL granting time-limited access to a private S3 object. Client uploads/downloads directly to S3 bypassing your server.

### Proxy (Forward vs Reverse) {#proxy}

- **Forward proxy:** Client → Proxy → Internet (hides client)
- **Reverse proxy:** Internet → Proxy → Server (hides server). NGINX is a reverse proxy.

---

## R

### Route Table {#route-table}

Rules determining where traffic goes within a VPC. Public subnet: `0.0.0.0/0 → IGW`. Private subnet: no internet route.

### RBAC (Role-Based Access Control) {#rbac}

Permissions assigned to roles (Admin, Editor, Viewer), users assigned roles.

---

## S

### Security Group {#security-group}

Instance-level virtual firewall. Rules specify allowed traffic by port, protocol, source. **Stateful** — response traffic auto-allowed. Can reference other SGs as source.

### SSL/TLS {#ssl-tls}

Protocols encrypting data in transit. The "S" in HTTPS. Prevents eavesdropping and tampering. Uses certificates from CAs.

### Subnet {#subnet}

A segment of a VPC's IP range. Resources are placed in subnets. Can be **public** (route to IGW) or **private** (no internet route).

### systemd {#systemd}

Linux's service manager. Define `.service` files for start-on-boot, restart-on-failure, log management.

---

## T

### TCP (Transmission Control Protocol) {#tcp}

Reliable, ordered, connection-oriented protocol. Uses three-way handshake. HTTP, SSH, DB connections run over TCP.

### TCP Handshake {#tcp-handshake}

```
Client ──SYN──► Server     "I want to connect"
Client ◄──SYN-ACK── Server "OK, acknowledged"  
Client ──ACK──► Server     "Connected!"
```

### TLS Handshake {#tls-handshake}

Browser and server negotiate encryption after TCP connects. Agree on ciphers, verify certificate, generate session keys.

### TTL (Time To Live) {#ttl}

In DNS: seconds a response can be cached. Low TTL (60s) = fast changes, more queries. High TTL (86400s) = fewer queries, slow updates.

---

## V

### VPC (Virtual Private Cloud) {#vpc}

Your isolated private network within AWS. You control IP range, subnets, route tables, gateways. Resources in different VPCs can't communicate by default.

---

## W

### WAF (Web Application Firewall) {#waf}

Inspects HTTP requests and blocks malicious patterns: SQL injection, XSS, bot traffic. Cloudflare (free) or AWS WAF (paid, more control).

---

*Use your browser's Back button to return to where you were reading.*
