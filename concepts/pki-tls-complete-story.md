---
title: "PKI, TLS & Certificates — The Complete Story"
description: "End-to-end deep dive connecting all dots: asymmetric crypto, digital signatures, certificate authorities, trust chains, the full TLS handshake, and mTLS — from buying a domain to loading a page securely."
order: 3
---

# PKI, TLS & Certificates — The Complete Story
### From "I bought signal-garden.fun" to "my dashboard loaded securely"

> **Category:** Security · **Difficulty:** Advanced · **Related:** [TLS, Certificates & HTTPS — From Scratch](/concepts/tls-certificates-https) · NGINX · Networking

> **Prerequisite:** Read [TLS, Certificates & HTTPS — From Scratch](/concepts/tls-certificates-https) first for the building blocks. This article connects everything end-to-end with a real-world scenario.

---

## Chapter 0 — Encryption Basics (The Foundation)

Before anything else, you need to know one rule that everything else is built on.

### Asymmetric Encryption: Two Keys, One Pair

Every entity (you, a server, a CA) generates a **keypair**:

```
Private Key  →  kept SECRET, never shared, never leaves your machine
Public Key   →  shared with the ENTIRE world, anyone can have it
```

The rule is simple: **always opposite keys decrypt**.

| What encrypted it | What decrypts it | Purpose |
|---|---|---|
| Public Key | Private Key | **Confidentiality** — only the owner can read it |
| Private Key | Public Key | **Signatures** — anyone can verify, only owner could sign |
| Public Key | Public Key | ❌ Impossible |
| Private Key | Private Key | ❌ Impossible |

### Use Case 1 — Confidentiality (encrypt with PUBLIC key)

```
You want to send a secret to Swaranshu:

1. Encrypt message with Swaranshu's PUBLIC key
   (anyone can have his public key — it's public)

2. Only Swaranshu's PRIVATE key can decrypt it
   (he's the only one with it)

3. Even YOU can't decrypt it after encrypting
```

### Use Case 2 — Signatures (encrypt with PRIVATE key)

```
Swaranshu wants to prove HE wrote something:

1. Hash the document:
   SHA256("I am signal-garden.xyz") → "8f3a9b2c..."

2. Encrypt the hash with Swaranshu's PRIVATE key
   → this encrypted hash is the SIGNATURE

3. Anyone with Swaranshu's PUBLIC key can:
   - Decrypt the signature → get "8f3a9b2c..."
   - Hash the document themselves → get "8f3a9b2c..."
   - Compare: match = proved Swaranshu signed it
```

> **The crux:** Only Swaranshu has his private key, so only he could have produced that signature. The public key verifies it — and public key is public — so the whole world can verify.

---

## Chapter 1 — The Problem Signatures Alone Don't Solve

Your signing flow is:
```
Sender:   document + signature + public key  →  you
You:      verify signature using that public key
```

But wait — **who sent you that public key?**

What if an attacker intercepted and swapped in their own public key?

```
Real server:    sends real public key [ABC...]
                         ↓
Attacker:       intercepts, swaps in their public key [EVIL...]
                         ↓
You receive:    EVIL's public key — you don't know
                         ↓
You verify:     signature made with EVIL's private key
                against EVIL's public key → passes ✅
                         ↓
You think:      "Verified! This is the real server."
                But you're talking to the attacker.
```

Verification only proves: **"this was signed by whoever owns this private key."**
It does NOT prove **who that person actually is.**

This is the problem a Certificate Authority (CA) solves.

---

## Chapter 2 — What is a CA and What Does It Actually Do?

A CA is just an entity that:
1. Has its own keypair (private key + public key)
2. Uses its private key to **sign a binding between a name and a public key**
3. Gets its own certificate pre-installed in every OS/browser on earth

A **certificate** is not just a public key. It is:

```
Certificate contains:
├── "This public key belongs to signal-garden.fun"
├── Valid from: 2026-01-01
├── Valid until: 2026-09-01
├── Issued by: Let's Encrypt
├── The actual public key: [ABC...]
└── Let's Encrypt's SIGNATURE over all of the above
    (SHA256 of content, encrypted with Let's Encrypt's private key)
```

The CA's signature is the CA saying: **"I verified this domain owns this key. I vouch for it."**

---

## Chapter 3 — Why Do We Trust Root CAs?

Root CA certificates are self-signed. Anyone can make one. So why do we trust them?

**Because humans decided to. Full stop.**

```
Microsoft / Apple / Mozilla
        ↓  legal audits, background checks, WebTrust audits
Root CA (DigiCert, Let's Encrypt, GlobalSign...)
        ↓  passed all checks → included in OS trust store
Your device ships with that trust store pre-installed
        ↓
You trust your OS vendor
        → you transitively trust those Root CAs
```

There is no deeper cryptographic magic. The trust is **social and institutional**, not mathematical. The math only enforces decisions once they've been made.

### Can you make your own Root CA and install it?

**Yes.** And it will work — on your machine.

```bash
sudo cp my-root-ca.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

After this, your system trusts any cert signed by your CA. This is exactly what corporate IT departments do — they push a company Root CA to all employee machines.

| | Your self-signed CA | DigiCert |
|---|---|---|
| Works on your machine | ✅ | ✅ |
| Works on strangers' browsers | ❌ | ✅ |
| Passed OS vendor audits | ❌ | ✅ |
| Shipped in billions of devices | ❌ | ✅ |

The difference is **distribution and vetting**, not technology. Their cert is cryptographically identical in structure to yours.

> **The crux:** Trust is not in the cryptography of the Root CA. Trust is in who distributed it to your device and why.

---

## Chapter 4 — The Setup: Before Any Request Happens

### You bought signal-garden.fun

You did two things after buying the domain:

**Step 1 — DNS: point domain to your AWS server**
```
In your registrar's DNS panel:
signal-garden.fun  →  A record  →  13.12.233.122
```
Now when anyone asks "where is signal-garden.fun?", the internet says `13.12.233.122`.

**Step 2 — Get a certificate from Let's Encrypt**

You ran on your Ubuntu server:
```bash
certbot --domain signal-garden.fun
```

Here is what certbot did, step by step:

```
Step A: Generate a keypair ON your server
        Private key → stays on server, never leaves
        Public key  → will go into the certificate

Step B: Prove to Let's Encrypt you own signal-garden.fun
        Let's Encrypt places a challenge file on your server
        Checks if signal-garden.fun/.well-known/challenge/xyz returns it
        Only the real domain owner can do this

Step C: You tell Let's Encrypt:
        "I am signal-garden.fun and my public key is [ABC...]"

Step D: Let's Encrypt SIGNS your certificate:
        content = "signal-garden.fun owns public key [ABC...]
                   valid until 2026-09-01, issued by Let's Encrypt"

        hash = SHA256(content) → "f3a9b2..."

        signature = encrypt("f3a9b2..." with Let's Encrypt's PRIVATE KEY)
        → "z9x2mq..."

        Certificate = content + signature

Step E: This certificate is now on your server
```

Your server now has two files:
```
/etc/ssl/private/signal-garden.fun.key   ← server's private key (SECRET)
/etc/ssl/certs/signal-garden.fun.crt     ← certificate (public, shareable)
```

Let's Encrypt's public key is already in your laptop's trust store — it came pre-installed with your OS.

---

## Chapter 5 — The Full Request: signal-garden.fun/dashboard

You type `signal-garden.fun/dashboard` in your browser. Here is every step.

---

### Phase 1 — DNS: "Where is this domain?"

```
Your laptop:   "Who is signal-garden.fun?"
      ↓
DNS resolver:  checks records
      ↓
Answer:        "13.12.233.122"

Your laptop now knows to connect to 13.12.233.122
```

---

### Phase 2 — TCP: "Open a pipe"

```
Laptop   →   SYN            →   13.12.233.122
Laptop   ←   SYN-ACK        ←   13.12.233.122
Laptop   →   ACK            →   13.12.233.122
```

Raw pipe is open. No encryption yet. Anyone sitting in the middle can read everything. This is why Phase 3 exists.

---

### Phase 3 — TLS Handshake: "Prove who you are, then encrypt everything"

This is the most important phase.

#### Step 3.1 — Your laptop says hello

```
Laptop → Server:

"Hello. I support these encryption methods: AES-256, ChaCha20...
 Pick one.
 Here is a random number I just generated:
 ClientRandom = 'x7f2a9b3c...'"
```

#### Step 3.2 — Server responds with its certificate

```
Server → Laptop:

"I pick AES-256.
 Here is MY random number: ServerRandom = 'b3d9c1f2...'
 And here is my certificate:"

Certificate:
├── "I am signal-garden.fun"
├── "My public key is [ABC...]"
├── "Valid until 2026-09-01"
├── "Issued by: Let's Encrypt"
└── Let's Encrypt's signature: "z9x2mq..."
    (SHA256 of above content, encrypted with Let's Encrypt's private key)
```

#### Step 3.3 — Your laptop verifies the certificate

```
Laptop thinks:

"The cert says it was signed by Let's Encrypt.
 Do I have Let's Encrypt's public key?
 Let me check my trust store..."

Laptop opens /etc/ssl/certs/ (or OS trust store)
→ finds Let's Encrypt's public key [LEx...]

Now laptop verifies:

1. Take the signature from cert: "z9x2mq..."
2. DECRYPT it using Let's Encrypt's PUBLIC KEY [LEx...]
   → gets back the hash: "f3a9b2..."
3. Laptop computes SHA256 of the cert content itself
   → "f3a9b2..."
4. Compare:
   "f3a9b2..." == "f3a9b2..."  →  MATCH ✅

Conclusion:
"Let's Encrypt vouches that public key [ABC...] belongs to signal-garden.fun.
 I trust Let's Encrypt (they are in my OS trust store).
 Therefore I now trust this server's public key [ABC...]."
```

Your laptop never needed the server's private key. It used Let's Encrypt's public key — already on your laptop — to verify the server's identity.

#### Step 3.4 — Key Exchange: generate a shared secret

Now both sides need to agree on one encryption key for all future data. They can't just send it in plaintext — someone could intercept it.

So they do this:

```
Laptop generates a random value:
PreMasterSecret = "k9z3m7p2..."

Laptop encrypts it:
encrypt(PreMasterSecret with server's PUBLIC KEY [ABC...])
→ "zzx99qw8..." (gibberish to anyone without the private key)

Laptop → Server: sends "zzx99qw8..."

Server decrypts using its PRIVATE KEY (only it has this):
→ gets back "k9z3m7p2..."

Now BOTH sides independently compute:
MasterSecret = some_function(ClientRandom + ServerRandom + PreMasterSecret)
             = "session_key_9f3bc7..."

Nobody intercepting the wire ever saw PreMasterSecret in plaintext.
Both sides now share this session key without it ever crossing the wire unencrypted.
```

#### Step 3.5 — Both confirm: switching to encrypted

```
Laptop → Server: "Finished" (encrypted with session_key_9f3bc7...)
Server → Laptop: "Finished" (encrypted with session_key_9f3bc7...)

TLS handshake complete.
Everything from here is encrypted.
```

---

### Phase 4 — The Actual HTTP Request

```
What you want to send (plaintext):
"GET /dashboard HTTP/1.1
 Host: signal-garden.fun
 Cookie: user_session=abc123"

Laptop encrypts with session_key_9f3bc7...
→ "8f2xzqp339xb..." (encrypted blob)

Laptop → Server: sends encrypted blob

Server decrypts with same session_key_9f3bc7...
→ reads your GET /dashboard request
→ checks cookie, authenticates you
→ prepares the dashboard HTML
```

---

### Phase 5 — Server sends back your dashboard

```
Server's response (plaintext):
"HTTP/200 OK
 <html>Welcome to your dashboard, Swaranshu...</html>"

Server encrypts with session_key_9f3bc7...
→ "k3mx99zab7..." (encrypted blob)

Server → Laptop: sends encrypted blob

Laptop decrypts with session_key_9f3bc7...
→ Browser renders your dashboard
```

---

## Chapter 6 — The Question That Trips Everyone: Which CA Is Used?

Your OS has 100+ CA certificates. When a server presents its cert, which CA's public key does your laptop use to verify it?

**The server tells you. The certificate contains an "Issuer" field.**

```
TLS Handshake:

1. Your laptop: "Hello"
2. Server sends certificate:
   └── Certificate says: Issuer = "Let's Encrypt Authority R11"

3. Your laptop scans its trust store:
   └── Do I have "Let's Encrypt Authority R11"? YES
   └── Use THAT CA's public key to verify the cert

4. Verification passes → proceed

The other 99 CAs are irrelevant for this connection.
```

---

## Chapter 7 — A Common Confusion: Server's `/etc/ssl/certs/` vs Your Laptop's

When you visit signal-garden.fun, there are two trust stores in play:

```
Your Laptop's trust store
→ Used to verify the SERVER's certificate
→ Contains Root CAs pre-installed by your OS (Let's Encrypt, DigiCert, etc.)
→ This is what matters when YOU are the visitor

Ubuntu Server's /etc/ssl/certs/
→ Used when the SERVER makes OUTGOING requests
  (e.g., server calling Stripe API, Razorpay, SendGrid)
→ Irrelevant for verifying itself to visitors
```

```
/etc/ssl/certs/signal-garden.fun.crt   ← what server PRESENTS to visitors
/etc/ssl/certs/ (OS trust store)       ← what server uses when IT calls other APIs
```

**Each side uses its OWN trust store to verify the OTHER side.**

---

## Chapter 8 — The Private System (Your Laptop ↔ AWS Server)

You don't always need a publicly trusted CA. If you control both ends:

```
Your Laptop                          AWS Server
──────────                           ──────────
Has your self-signed Root CA cert    Has your self-signed Root CA cert
Has client cert signed by that CA    Has server cert signed by that CA
        │                                     │
        └──────── TLS handshake ──────────────┘
                  Both verify each other
                  against the SAME shared CA
```

Since both sides have the same CA cert installed, they trust each other. The world not trusting your CA is completely irrelevant — you only need the two machines to agree.

This is called **Mutual TLS (mTLS)** and is more secure than security groups alone:

| Security Groups | mTLS |
|---|---|
| Works at IP/port level | Works at identity level |
| Anyone who discovers the IP can knock | Even if they find your IP, they can't handshake without your client cert |
| No cryptographic proof of identity | Cryptographically proves who is connecting |

This exact pattern is used by Kubernetes, Cloudflare's internal network, and microservices inside companies.

---

## Chapter 9 — The Kazakhstan Scenario: MITM vs Routing

Two completely different things:

### Does a cross-border connection fail?

```
Your laptop (India) ──── HTTPS ───→ Server in Kazakhstan
```

For this to work, the server presents its certificate. Your laptop checks: **"Is this cert signed by a CA I trust?"**

The server being physically in Kazakhstan is irrelevant. What matters is who signed the cert. If it's signed by Let's Encrypt (which your laptop trusts), the connection works perfectly. The server doesn't need India's Root CA. The server's location has nothing to do with the trust chain.

### The actual Kazakhstan Govt CA attack

If Kazakhstan's govt Root CA is in your laptop's trust store:

```
You         → think you're connecting to google.com
                        ↓
Kazakhstan ISP intercepts your connection
Presents a FAKE google.com certificate
Signed by Kazakhstan Govt CA
                        ↓
Your laptop checks:
"Is this cert trusted?"
YES — Kazakhstan Govt CA is in my trust store ✅
                        ↓
You're now talking to their proxy, not Google.
They decrypt your traffic, read it, re-encrypt and forward.
You never know.
```

The danger isn't that connections to Kazakhstan fail. The danger is that a **malicious CA in your trust store lets them impersonate any website to you**, regardless of where those sites physically are.

> **The distinction:** Root CAs in your trust store are about who you let vouch for others. A server's physical location is completely irrelevant to the trust chain.

---

## The Complete Picture — One Final Diagram

```
BEFORE (One Time Setup)
───────────────────────
Let's Encrypt generates keypair
├── Private key → locked in vault, air-gapped machine
└── Public key → shipped in EVERY OS trust store worldwide

signal-garden.fun generates keypair on AWS server
├── Private key → stays on server, /etc/ssl/private/
└── Public key → goes into certificate

Let's Encrypt signs certificate for signal-garden.fun
└── Certificate → installed on server, /etc/ssl/certs/


DURING (Every Request)
──────────────────────
You type signal-garden.fun/dashboard
         ↓
DNS: resolves to 13.12.233.122
         ↓
TCP: raw connection established
         ↓
TLS Handshake:
  Server presents certificate
    └── "signal-garden.fun owns [ABC...], signed by Let's Encrypt"
  Your laptop finds Let's Encrypt in trust store
  Decrypts signature using Let's Encrypt's public key
  Hash matches → server identity VERIFIED ✅
  Session key negotiated (encrypted with server's public key)
         ↓
HTTP: GET /dashboard (encrypted with session key)
         ↓
Response: dashboard HTML (encrypted with session key)
         ↓
Browser renders your dashboard
```

---

## One Line Crux of the Entire Thing

**PKI trust is a pyramid of human decisions, not math — the cryptography just enforces those decisions once made.**

The Root CA is trusted because someone with reach (Apple, Microsoft, Mozilla) decided it was trustworthy and shipped it to billions of devices. You can replicate the technology in an afternoon. You cannot replicate the distribution and institutional trust in a lifetime.

---

*Notes compiled from a conversation about PKI, TLS, certificates, and the complete request lifecycle for signal-garden.fun*
