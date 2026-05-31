---
title: "Phase 9 — Application Authentication & Authorization"
description: "JWT, OAuth 2.0, bcrypt, sessions — building secure user identity into your app. The complete auth playbook."
order: 9
---

# Phase 9 — Application Authentication & Authorization

> **Category:** Security · **Difficulty:** Intermediate → Advanced · **Related:** JWT · OAuth · CORS

---

## TLDR

**Authentication** = "Who are you?" (login). **Authorization** = "What can you do?" (permissions). JWT is the standard for API auth — server signs a token, client sends it with every request. Passwords must be bcrypt-hashed. OAuth 2.0 handles "Sign in with Google." Never store sensitive data in JWT payload (it's base64, not encrypted). Use refresh tokens for long sessions.

---

## 01 — Authentication vs Authorization

| | Authentication (AuthN) | Authorization (AuthZ) |
|--|----------------------|---------------------|
| Question | "Who are you?" | "What can you do?" |
| When | First (login) | After (every request) |
| Mechanism | Password, OAuth, biometric | Roles, permissions, policies |
| HTTP code on failure | 401 Unauthorized | 403 Forbidden |
| Example | Login with email/password | "Only admins can delete users" |

```
Request flow:
  1. User sends credentials (AuthN)
  2. Server verifies → issues token
  3. Every subsequent request includes token
  4. Server: "Is this token valid?" (AuthN check)
  5. Server: "Can this user do THIS action?" (AuthZ check)
```

---

## 02 — JWT (JSON Web Tokens) — The Standard

### Structure

```
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjEyM30.signature
│                      │                      │
└── Header (base64)    └── Payload (base64)   └── Signature
```

**Decoded:**

```json
// Header
{ "alg": "HS256", "typ": "JWT" }

// Payload (claims)
{
  "userId": 123,
  "email": "user@example.com",
  "role": "admin",
  "iat": 1717100000,    // Issued at
  "exp": 1717103600     // Expires (1 hour later)
}

// Signature
HMAC_SHA256(
  base64(header) + "." + base64(payload),
  SERVER_SECRET_KEY
)
```

### Critical Security Points

- ⚠️ Payload is **base64-encoded, NOT encrypted**. Anyone can decode it. NEVER put passwords, secrets, or sensitive PII in it.
- ✅ Signature prevents **tampering** — change one character and signature becomes invalid.
- ✅ Stateless — server doesn't need to store sessions in DB.

### JWT Flow

```
1. User: POST /login { email, password }
2. Server: Verify password (bcrypt compare)
3. Server: Generate JWT, sign with SECRET
4. Server: Return { token: "eyJ..." }
5. Client: Store token (localStorage or httpOnly cookie)
6. Client: Every request → Authorization: Bearer eyJ...
7. Server middleware: Verify signature + check expiration
8. If valid → process request
9. If expired → 401 → client uses refresh token
```

### Implementation

```javascript
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET; // 256-bit random string

// Issue token
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    SECRET,
    { expiresIn: '1h' }
  );
}

// Verify middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]; // "Bearer TOKEN"
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;  // Attach user info to request
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

## 03 — Refresh Tokens (Long Sessions Without Risk)

### The Problem

Short-lived tokens (1h) are secure but annoying (re-login every hour). Long-lived tokens (30 days) are convenient but risky (stolen token = 30 days of access).

### The Solution: Token Pair

```
Access Token:  Short-lived (15min-1h). Used for API requests.
Refresh Token: Long-lived (7-30 days). Used ONLY to get new access tokens.
```

### Flow

```
1. Login → Server returns { accessToken (1h), refreshToken (30d) }
2. Client uses accessToken for API calls
3. accessToken expires → 401
4. Client: POST /refresh { refreshToken }
5. Server: Verify refresh token → issue NEW accessToken
6. If refresh token expired → full re-login required
```

### Why This Is Safer

- Access token stolen? Attacker has 1 hour max.
- Refresh token stolen? Revoke it server-side (stored in DB).
- Refresh tokens can be single-use (rotate on every refresh).

---

## 04 — Password Security: bcrypt

### Why Not Plain Hashing (SHA-256)?

SHA-256 is FAST. An attacker with a GPU can compute **billions** of SHA-256 hashes per second. They'll crack "password123" instantly.

### Why bcrypt?

Bcrypt is **intentionally slow** (configurable). With cost factor 12:
- ~250ms per hash attempt
- Attacker's speed: ~4 hashes/second (instead of billions)
- Brute-force becomes impractical

```javascript
const bcrypt = require('bcrypt');
const COST_FACTOR = 12;  // Higher = slower = more secure

// Registration
async function register(email, password) {
  const hash = await bcrypt.hash(password, COST_FACTOR);
  // Store hash in DB (not the password!)
  await db.user.create({ email, passwordHash: hash });
}

// Login
async function login(email, password) {
  const user = await db.user.findOne({ where: { email } });
  if (!user) return null; // Don't reveal "user not found" vs "wrong password"
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  
  return generateToken(user);
}
```

### bcrypt Hash Anatomy

```
$2b$12$LJ3m4ov.rPJGM9YkG5hOseFZ1QzajVMFh6yTb/uU6VBL1G.JCrWGy
│   │  │                                                          │
│   │  └── Salt (random, unique per password)                      │
│   └── Cost factor (2^12 = 4096 rounds)
└── Algorithm version
```

**Each hash includes its own random salt** — identical passwords produce different hashes.

---

## 05 — OAuth 2.0 (Social Login)

### "Sign in with Google" Flow

```
1. User clicks "Sign in with Google" on YOUR site
2. Redirect → Google's auth page (consent screen)
3. User authenticates with Google
4. Google redirects back to YOUR callback URL with an authorization code
5. YOUR backend exchanges code for Google access token (server-to-server)
6. YOUR backend fetches user profile from Google API
7. Create/find user in YOUR database
8. Issue YOUR JWT to the user
```

### Why Exchange Code Server-Side?

The authorization code is short-lived and useless without your client_secret. Even if intercepted, attacker can't use it without your server's credentials.

---

## 06 — Authorization Patterns

### RBAC (Role-Based Access Control)

```javascript
// Middleware
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Routes
app.delete('/api/users/:id', authenticate, authorize('admin'), deleteUser);
app.get('/api/users', authenticate, authorize('admin', 'manager'), listUsers);
app.get('/api/profile', authenticate, getProfile); // Any authenticated user
```

### Resource-Based (Ownership)

```javascript
app.put('/api/posts/:id', authenticate, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (post.authorId !== req.user.userId) {
    return res.status(403).json({ error: 'Not your post' });
  }
  // Allow edit...
});
```

---

## 07 — CORS (Cross-Origin Resource Sharing)

### The Problem

Browser blocks: Frontend at `http://localhost:3000` calling API at `http://localhost:8000`.

### The Solution

```javascript
const cors = require('cors');

app.use(cors({
  origin: ['https://myapp.com', 'http://localhost:3000'],
  credentials: true,  // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### How CORS Works

```
Browser: "Can I call api.myapp.com from app.myapp.com?"
         → Sends OPTIONS preflight request

Server: "Access-Control-Allow-Origin: https://app.myapp.com"
         → "Yes, you may."

Browser: Proceeds with actual request.
```

---

## 08 — Cookie Security Flags

If storing tokens in cookies:

```javascript
res.cookie('token', jwt, {
  httpOnly: true,    // JavaScript can't read it (XSS protection)
  secure: true,      // Only sent over HTTPS
  sameSite: 'strict', // Not sent with cross-site requests (CSRF protection)
  maxAge: 3600000    // 1 hour
});
```

| Flag | Protects Against |
|------|-----------------|
| `httpOnly` | XSS (script can't steal token) |
| `secure` | Network sniffing (only HTTPS) |
| `sameSite` | CSRF (cross-site request forgery) |

---

## 🧠 Quick Recall

1. What's in a JWT's three parts?
2. Why is JWT payload NOT encrypted?
3. Why bcrypt over SHA-256 for passwords?
4. What's the refresh token pattern?
5. 401 vs 403 — what's the difference?
6. What does `httpOnly` cookie flag prevent?

---

## 🎯 Interview Q&A

**Q: JWT vs Session-based auth — tradeoffs?**

A: JWT: stateless (no server-side storage), scales horizontally easily, works across services. Downside: can't revoke individual tokens easily (until expiry). Sessions: stored server-side, easy to revoke (delete session), but requires shared storage (Redis) for horizontal scaling. JWT wins for microservices/APIs; sessions work for monoliths with server-rendered pages.

**Q: How would you implement token revocation with JWTs?**

A: Options: (1) Short expiry + refresh tokens (revoke refresh token in DB). (2) Token blacklist in Redis (check on every request — partially defeats stateless benefit). (3) Token versioning — user has a "tokenVersion" field; increment on logout, reject tokens with old version.

**Q: How does bcrypt prevent rainbow table attacks?**

A: Each bcrypt hash includes a unique random salt. Even if two users have password "abc123", their hashes are completely different. Rainbow tables (pre-computed hash→password mappings) are useless because they'd need tables for every possible salt.

**Q: Explain the OAuth 2.0 Authorization Code flow and why it's more secure than Implicit flow.**

A: Auth Code: code returned to frontend → exchanged server-to-server for token (code + client_secret). Token never exposed to browser. Implicit (deprecated): token returned directly in URL fragment → visible in browser history, logs, referrer headers. Auth Code with PKCE is now the standard even for SPAs.

---

## 🤔 Brainstorming Questions

1. **If JWTs are "stateless," how do you handle logout?** (The token is still valid until expiry. What can you do?)

2. **You're building a multi-tenant SaaS.** User belongs to multiple orgs with different roles in each. How do you structure JWT claims and authorization checks?

3. **An attacker steals a refresh token.** How do you detect and mitigate this? (Token rotation, device fingerprinting, concurrent session detection)

4. **Why store passwords at all?** Could you build a passwordless system? What are the tradeoffs? (Magic links, WebAuthn, passkeys)

5. **CORS is a browser-only restriction.** An attacker using curl/Postman isn't stopped by CORS. So what's the actual security benefit? (Think: protecting the user's browser from being weaponized)

---

*Previous: [Phase 8 — EC2 ↔ RDS](/aws-infrastructure/08-ec2-rds-connection) · Next: [Phase 10 — AWS IAM](/aws-infrastructure/10-aws-iam)*
