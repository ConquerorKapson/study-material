# Study Material Site — Developer Instructions

This document captures everything you need to know to develop, extend, and deploy this site. Read it fully before making changes.

---

## 1. Project Overview

A Next.js 14 (App Router) static site for structured engineering study notes. Articles are written in Markdown and automatically picked up by the content engine — no code changes needed to add new articles or topics.

**Live URL:** Deployed on Vercel (auto-deploy on every push to `main`)  
**Repository:** [ConquerorKapson/study-material](https://github.com/ConquerorKapson/study-material)  
**Theme:** Warm newspaper / editorial aesthetic (cream paper, ink black, editorial red accents)

---

## 2. Git & GitHub Configuration

> ⚠️ **IMPORTANT — Personal Account Only**  
> This repo belongs to the **personal** GitHub account. All git operations MUST use the personal SSH config alias `github-personal`, not `github.com` directly. Using `github.com` may route to a work/corporate account (e.g., PineLabs) and will trigger security policy violations.

### SSH Alias

The `~/.ssh/config` file has an entry like:

```
Host github-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_rsa_personal   # or whichever key is for personal account
```

The git remote is configured to use this alias:

```
origin  git@github-personal:ConquerorKapson/study-material.git
```

**Never** change the remote to `git@github.com:ConquerorKapson/study-material.git`.

### Git Identity

The repo-level git config is set to the personal identity:

```
user.name  = Swaranshu Kapoor
user.email = swaranshu0810kapoor@gmail.com
```

Verify before committing:

```bash
git config user.email   # should output: swaranshu0810kapoor@gmail.com
git config user.name    # should output: Swaranshu Kapoor
```

If they're wrong (showing a work email), fix them:

```bash
git config user.email "swaranshu0810kapoor@gmail.com"
git config user.name "Swaranshu Kapoor"
```

---

## 3. Vercel Deployment (CI/CD Pipeline)

Deployment is fully automatic:

1. Push any commit to the `main` branch
2. Vercel detects the push via GitHub webhook
3. Vercel runs `npm run build` (Next.js static export)
4. If the build passes, the new version goes live in ~1–2 minutes

**No manual deployment steps are needed.** Never run `vercel deploy` manually unless absolutely necessary.

### Vercel Account

The Vercel project is linked to the personal GitHub account (`swaranshu0810kapoor@gmail.com`), **not** any work/organization account.

### Build Command (what Vercel runs)

```bash
npm run build
```

Always verify the build passes locally before pushing:

```bash
cd d:\prep\study-material
npm run build
```

A successful build will list all static routes including your new article, e.g.:
```
○ /databases/opensearch-elasticsearch
○ /concepts/outbox-pattern
```

---

## 4. Local Development

```bash
cd d:\prep\study-material
npm install          # only needed first time or after package changes
npm run dev          # starts dev server on http://localhost:3020
```

The dev server port is `3020` (configured in `package.json`).

---

## 5. How to Add New Articles

The content engine (`lib/content.ts`) auto-discovers `.md` files from any top-level folder that is not a reserved system folder.

### Reserved folders (excluded from topics)

`app`, `components`, `lib`, `public`, `node_modules`, `.next`, `.vercel`, `.git`, `.github`, `styles`

### Steps to add an article

1. **Choose or create a topic folder** — e.g., `databases/`, `concepts/`, `caching/`, `design_questions/`
2. **Create a `.md` file** inside that folder — e.g., `databases/my-topic.md`
3. **Add frontmatter** at the top of the file:

```markdown
---
title: "My Topic Title"
description: "One-sentence description shown in the listing card."
order: 1
---

# My Topic Title

> **Category:** Systems · **Difficulty:** Advanced · **Related:** Kafka · Redis

---

## 01 — First Section

Content here...
```

4. **Article style conventions** (match the editorial theme):
   - Section headers use format: `## 01 — Section Name`
   - Use `>` blockquotes for interview callouts / pro tips
   - Use fenced code blocks with language hints (` ```sql `, ` ```json `, etc.)
   - Use emoji indicators (✅ ❌ ⚠️ 🟢 🟡 🔴) in tables for at-a-glance comparison
   - Bold the first column of comparison tables: `| **Dimension** | ... |`
   - Use `---` horizontal rules between major sections

5. **Build and verify locally**, then push to `main`

---

## 6. Current Topic Structure

| Folder | URL prefix | Content |
|---|---|---|
| `concepts/` | `/concepts/` | System design concepts (e.g., Outbox Pattern) |
| `databases/` | `/databases/` | Database & search engine deep dives |
| `caching/` | `/caching/` | Caching strategies and tools |
| `design_questions/` | `/design_questions/` | System design interview questions |

---

## 7. Theme & Styling

### Color Palette (defined in `tailwind.config.ts`)

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#f5f0e8` | Page background (cream paper) |
| `ink` / `text` | `#0f0e0c` | Primary text |
| `accent` | `#c8392b` | Editorial red — active states, highlights |
| `accent2` | `#b8860b` | Gold — secondary accents |
| `muted` | `#6b6560` | Subdued text, labels |
| `border` | `#d4cfc6` | Dividers and borders |
| `panel` | `#ece7dd` | Card backgrounds |
| `panel2` | `#e3ddd2` | Alternate card bg |
| `code-bg` | `#1a1917` | Dark background for code blocks |

### Fonts (loaded via Google Fonts in `globals.css`)

| Font | Usage |
|---|---|
| Playfair Display | Headings (`font-serif`) |
| DM Sans | Body text (`font-sans`) |
| JetBrains Mono | Code, monospace labels |

### Key style files

- `tailwind.config.ts` — color palette and font definitions
- `app/globals.css` — all custom CSS including prose overrides, font imports, progress bar
- Prose is rendered with Tailwind Typography — use `prose prose-stone` class (NOT `prose-invert` — that is for dark backgrounds and makes text nearly invisible on the light theme)

---

## 8. Known Gotchas & Decisions

### ❌ Do NOT use `prose-invert`

`prose-invert` is Tailwind Typography's modifier for dark backgrounds. It bleaches all text to light colors. The article page (`app/[topic]/[slug]/page.tsx`) uses `prose prose-stone` — never change this back to `prose-invert`.

### Table `td` colors

Table body text uses explicit color overrides in `globals.css`:
- `td` text: `#1a1917` (near-black, readable)
- `td:first-child`: `#1a4a6b` with monospace font (label/key column gets special blue treatment)

### Highlight.js theme

Code syntax highlighting uses `github.css` (light theme) imported in `app/layout.tsx`. Do **not** switch to `github-dark.css` — it clashes with the light theme.

### SSH alias is mandatory

The git remote uses `github-personal` SSH alias. If you re-clone or re-initialize the repo, you must re-add the remote with the alias:

```bash
git remote add origin git@github-personal:ConquerorKapson/study-material.git
```

---

## 9. Commit Message Convention

Use the conventional commits format:

```
feat: add <topic> article to <folder> topic
fix: <what was broken and how it was fixed>
refactor: <what was restructured>
```

Examples from this project:
```
feat: add OpenSearch & Elasticsearch polished study article to databases topic
fix: improve text readability - remove prose-invert, darken td and body text
feat: move outbox-pattern to concepts topic + retheme site to warm newspaper aesthetic
```

---

## 10. Full Deploy Workflow (end-to-end)

```bash
# 1. Navigate to project
cd d:\prep\study-material

# 2. Make changes (add/edit .md files or code)

# 3. Verify build passes
npm run build

# 4. Stage and commit
git add -A
git commit -m "feat: describe what you added"

# 5. Push to main — Vercel auto-deploys
git push origin main

# 6. Wait ~1-2 minutes, then check the live site
```

That's all. No other steps needed.
