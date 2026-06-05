---
title: "TLS, Certificates & HTTPS — From Scratch"
description: "Deep dive into how HTTPS works: asymmetric crypto, digital signatures, certificate chains, TLS handshake, and manual certificate setup."
order: 2
---

# TLS, Certificates & HTTPS — From Scratch

> **Category:** Security · **Difficulty:** Advanced · **Related:** NGINX · Networking · Cryptography

---

## 01 — The Problem HTTPS Solves

```
WITHOUT HTTPS (plain HTTP):

You ──────── WiFi/ISP/Network ──────── Server
     "password=hunter2"
     
     Anyone on the path can read this:
     - Your ISP
     - The coffee shop WiFi owner
     - A hacker on the same network (MITM)
     - Government surveillance
```

Two problems to solve:
1. **Encryption** — nobody can read the data in transit
2. **Identity** — how do you know you're talking to the REAL server and not an impersonator?

---

## 02 — Asymmetric Cryptography (The Foundation)

```
┌─── KEY PAIR ─────────────────────────────────────────────────┐
│                                                               │
│  Private Key (secret, only you have it)                      │
│  Public Key (shared with everyone)                           │
│                                                               │
│  Rule 1: Encrypt with Public Key → Only Private Key decrypts │
│  Rule 2: Sign with Private Key → Public Key verifies it      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**Analogy:**
- **Public Key** = an open padlock you hand out to everyone
- **Private Key** = the only key that opens that padlock

Anyone can PUT a message in the box and lock it (encrypt with public key).
Only YOU can open it (decrypt with private key).

---

## 03 — Digital Signatures — "Proof I wrote this"

```
HOW SIGNING WORKS:

1. You have a document: "I am signal-garden.xyz"
2. You hash it: SHA-256("I am signal-garden.xyz") → 8f3a9b2c...
3. You encrypt the hash with YOUR PRIVATE KEY → that's the signature
4. You send: document + signature + your public key

HOW VERIFICATION WORKS:

1. Receiver gets: document + signature + public key
2. Receiver hashes the document: SHA-256("I am signal-garden.xyz") → 8f3a9b2c...
3. Receiver decrypts signature using public key → gets 8f3a9b2c...
4. Compare: do they match? 
   YES → document is authentic, wasn't tampered with
   NO  → someone modified it, reject!
```

**Key insight:** Only someone with the private key could have produced that signature. If the public key successfully decrypts it, it MUST have come from the private key holder.

---

## 04 — The Trust Problem — Who Do You Trust?

```
Problem:
  Anyone can generate a key pair.
  A hacker can say "I'm signal-garden.xyz, here's MY public key"
  How does the browser know which public key is the REAL one?

Solution:
  A TRUSTED THIRD PARTY vouches for you.
  This is a Certificate Authority (CA).
```

**Certificate Authority (CA) hierarchy:**
```
┌── Root CAs (pre-installed in your browser/OS) ──────────────────┐
│  - DigiCert                                                       │
│  - Let's Encrypt (ISRG Root)                                     │
│  - GlobalSign                                                     │
│  - Comodo                                                         │
│  Your browser ships with ~150 trusted root CAs                   │
│  These are the "elders" everyone trusts by default               │
└──────────────────────────────────────────────────────────────────┘
         │
         │ signs (vouches for)
         ▼
┌── Intermediate CAs ──────────────────────────────────────────────┐
│  Let's Encrypt's "R3" intermediate                               │
│  These sign your actual certificates                             │
└──────────────────────────────────────────────────────────────────┘
         │
         │ signs (vouches for)
         ▼
┌── Your Certificate ──────────────────────────────────────────────┐
│  "signal-garden.xyz is owned by the holder of this public key"   │
│  Valid: 2026-06-05 to 2026-09-03 (90 days)                      │
│  Signed by: Let's Encrypt R3                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Chain of trust:**
```
Browser asks: "Do I trust this certificate for signal-garden.xyz?"
  → "Who signed it?" → Let's Encrypt R3
  → "Do I trust R3?" → "Who signed R3?" → ISRG Root X1
  → "Do I trust ISRG Root X1?" → YES (it's in my pre-installed list!)
  → ✅ Trust the certificate
```

---

## 05 — What IS a Certificate?

A certificate is just a structured file (X.509 format) containing:

```
┌── TLS CERTIFICATE (X.509 format) ───────────────────────────────┐
│                                                                   │
│  Subject: CN=signal-garden.xyz        ← who this cert is for    │
│  Issuer: CN=R3, O=Let's Encrypt      ← who signed it           │
│  Valid From: 2026-06-05               ← start date              │
│  Valid To: 2026-09-03                 ← expiry (90 days)        │
│  Public Key: 04:a3:2f:8b:...         ← YOUR server's public key│
│  Signature Algorithm: SHA256-RSA      ← how it was signed       │
│  Signature: 7d:3f:a2:1c:...          ← CA's signature of above │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**In plain English:** "Let's Encrypt certifies that the public key `04:a3:2f:8b...` belongs to `signal-garden.xyz`. Here's our signature to prove we said this."

---

## 06 — The TLS Handshake — What Happens When Browser Connects

```
Browser                                          Server (NGINX)
   │                                                │
   │  1. ClientHello                                │
   │  "Hi! I support TLS 1.3, these ciphers..."    │
   │─────────────────────────────────────────────▶ │
   │                                                │
   │  2. ServerHello + Certificate                  │
   │  "Let's use TLS 1.3, AES-256. Here's my cert" │
   │◀─────────────────────────────────────────────  │
   │                                                │
   │  3. Browser VERIFIES certificate:              │
   │     a. Is it expired? No ✅                    │
   │     b. Is the domain correct? Yes ✅           │
   │     c. Walk the chain:                         │
   │        cert → R3 → ISRG Root ✅               │
   │     d. Is it revoked? No ✅                    │
   │                                                │
   │  4. Key Exchange (Diffie-Hellman)              │
   │  Both sides compute a SHARED SECRET            │
   │  without ever sending it over the wire!        │
   │◀────────────────────────────────────────────▶ │
   │                                                │
   │  5. Both derive session keys from shared secret│
   │     Encrypt key (AES-256)                      │
   │     MAC key (integrity check)                  │
   │                                                │
   │  6. All further traffic encrypted with AES-256 │
   │  "GET /dashboard" ──encrypted──▶               │
   │  ◀──encrypted── "200 OK <html>..."            │
   │                                                │
```

**Why two types of encryption?**
- **Asymmetric (RSA/ECDSA):** Used ONLY for identity verification + key exchange. Slow.
- **Symmetric (AES-256):** Used for actual data encryption. Fast.

The handshake uses slow crypto to securely agree on a fast crypto key. Then everything after is fast.

---

## 07 — How to Do It Manually (Without Certbot)

### Step 1: Generate your private key

```bash
# On EC2:
sudo mkdir -p /etc/ssl/signal-garden
cd /etc/ssl/signal-garden

# Generate a 2048-bit RSA private key
sudo openssl genrsa -out server.key 2048
```

This creates your **private key**. Guard it. Anyone with this file can impersonate your server.

### Step 2: Create a Certificate Signing Request (CSR)

```bash
sudo openssl req -new -key server.key -out server.csr \
  -subj "/CN=signal-garden.xyz"
```

The CSR contains:
- Your **public key** (derived from the private key)
- The domain name you want certified
- Your organization info (optional)

**Analogy:** The CSR is you walking into the CA's office and saying "Here's my public key, please certify that I own signal-garden.xyz."

### Step 3: Prove you own the domain (ACME protocol)

Let's Encrypt uses the **ACME protocol** (Automatic Certificate Management Environment):

```
┌── THE CHALLENGE ────────────────────────────────────────────────┐
│                                                                   │
│  Let's Encrypt says:                                             │
│  "Put this random string at:                                     │
│   http://signal-garden.xyz/.well-known/acme-challenge/abc123"    │
│                                                                   │
│  You do it (serve the file via NGINX).                           │
│                                                                   │
│  Let's Encrypt fetches that URL.                                 │
│  If it gets the right response → you control the domain. ✅      │
│                                                                   │
│  Logic: Only someone who controls the domain's web server        │
│  can serve files at that URL. DNS points there, so you own it.  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Step 4: Receive your signed certificate

Let's Encrypt:
1. Takes your CSR (with your public key)
2. Verifies domain ownership (ACME challenge)
3. Signs a certificate: "This public key belongs to signal-garden.xyz"
4. Returns the signed certificate (`server.crt`) + intermediate cert (`chain.pem`)

You combine them: `cat server.crt chain.pem > fullchain.pem`

### Step 5: Configure NGINX with the certificate

```nginx
server {
    listen 443 ssl;
    server_name signal-garden.xyz;

    ssl_certificate     /etc/ssl/signal-garden/fullchain.pem;   # your cert + intermediate
    ssl_certificate_key /etc/ssl/signal-garden/server.key;       # your private key

    # Modern TLS settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name signal-garden.xyz;
    return 301 https://$host$request_uri;
}
```

### Step 6: Reload NGINX

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 08 — What Certbot Actually Does (The Black Box Opened)

Certbot is just automation of Steps 1-6:

```
certbot --nginx -d signal-garden.xyz

Under the hood:
  1. Generates private key         → openssl genrsa
  2. Creates CSR                   → openssl req -new
  3. Talks to Let's Encrypt API    → ACME protocol
  4. Serves challenge file         → temporarily modifies NGINX
  5. Receives signed certificate   → saves to /etc/letsencrypt/
  6. Modifies NGINX config         → adds ssl_certificate lines
  7. Sets up cron job              → auto-renews every 60 days
```

---

## 09 — The Full HTTPS Flow Visualized

```
AFTER TLS IS CONFIGURED:

Browser types: https://signal-garden.xyz/dashboard
    │
    ▼
DNS: signal-garden.xyz → 13.234.222.182
    │
    ▼
TCP connect to 13.234.222.182:443 (HTTPS port)
    │
    ▼
TLS Handshake:
    Browser ←→ NGINX exchange certificates, verify trust chain,
    derive AES-256 session key
    │
    ▼
Encrypted tunnel established (green padlock 🔒)
    │
    ▼
Browser sends (encrypted): GET /dashboard
    │
    ▼
NGINX decrypts → sees plain HTTP → proxy_pass to localhost:3000
    │
    ▼
Node.js handles request → returns HTML
    │
    ▼
NGINX encrypts response → sends back through tunnel
    │
    ▼
Browser decrypts → renders page

WHAT AN ATTACKER SEES:
    Random gibberish bytes. Can't read URLs, cookies, form data, nothing.
```

---

## 10 — Common Questions

### Why do certificates expire (every 90 days for Let's Encrypt)?

- If a private key is stolen, the damage is limited to 90 days max
- Forces automation (you MUST automate renewal = better security posture)
- Encourages adoption of newer, stronger algorithms over time

### If a hacker steals your certificate file (.crt), can they impersonate you?

**No.** The certificate only contains the public key. Without the private key (`server.key`), they can't complete the TLS handshake. The certificate is literally designed to be public.

### Node.js on port 3000 handles plain HTTP. Security problem?

**No**, because that traffic never leaves the machine. The connection between NGINX and Node.js is `localhost` (loopback interface). It never touches any network cable. An attacker would need root access on the EC2 itself, at which point TLS is irrelevant anyway.

### What's the difference between SSL and TLS?

SSL is the old, deprecated name (SSL 3.0 was the last version, broken in 2014). TLS is the modern successor (TLS 1.2, TLS 1.3). Everyone says "SSL certificate" but technically it's a TLS certificate. Same concept, better protocol.

---

## 11 — Key Takeaways

| Concept | One-liner |
|---------|-----------|
| Private key | Secret. Never leaves the server. Used to prove identity. |
| Public key | Shared openly. Used to encrypt messages TO the server. |
| Certificate | Public key + domain name + CA's signature = "I vouch for this" |
| CA | Trusted third party that signs certificates |
| Chain of trust | Your cert → Intermediate CA → Root CA (in browser) |
| CSR | "Please sign my public key for this domain" |
| ACME challenge | Proof of domain ownership via HTTP file placement |
| TLS handshake | Verify identity (asymmetric) → agree on session key (DH) → encrypt data (symmetric) |
| Certbot | Automates: keygen + CSR + ACME + install + renewal |
