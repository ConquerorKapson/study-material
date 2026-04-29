# Study Material Site

Personal SDE-2 / SDE-3 interview prep site. Markdown-driven, deployed on Vercel.

## How it works

- Every direct subfolder of this app (e.g. `caching/`) is a **topic**.
- Every `.md` file inside a topic folder is an **article**.
- Add a folder + a markdown file → push to GitHub → Vercel rebuilds → live.

No route wiring required. The sidebar, topic index, and article pages are auto-generated.

### Reserved folders (ignored as topics)
`app`, `components`, `lib`, `public`, `node_modules`, `.next`, `.vercel`, `.git`, `.github`, `styles`, and any folder starting with `.`.

## Adding a new topic

```
study-material/
  caching/
    caching-sde2-mastery.md
  databases/                 ← new topic
    indexing-deep-dive.md    ← new article
```

Optional frontmatter at the top of any `.md`:

```md
---
title: "Indexing Deep Dive"
description: "B-trees, hash, LSM, when each wins"
order: 1
---
```

If `title` is omitted, the filename is humanized.

## Markdown features supported

- GFM (tables, task lists, strikethrough, autolinks)
- Code blocks with syntax highlighting (`highlight.js`, GitHub Dark theme)
- Math via KaTeX: inline `$E=mc^2$` and block `$$ ... $$`
- Mermaid diagrams via fenced code:
  ````
  ```mermaid
  graph LR; A-->B
  ```
  ````
- Auto-generated TOC (right rail), reading progress bar, dark mode

## Local development

```powershell
cd study-material
npm install
npm run dev
```

Open http://localhost:3020.

## Deploying to Vercel

1. Create a **new GitHub repository** and push this `study-material/` folder as the repo root (recommended), OR push the whole `prep` repo and configure the **Root Directory** below.
2. On Vercel: **Add New… → Project → Import** the GitHub repo.
3. Configure project:
   - **Framework preset**: Next.js (auto-detected)
   - **Root Directory**: `study-material` (only if the repo contains other folders too; skip if `study-material/` is the repo root)
   - **Build command**: `next build` (default)
   - **Output**: `.next` (default)
   - **Install command**: `npm install` (default)
   - **Node version**: 18.x or 20.x
4. Click **Deploy**. Done.

Every subsequent `git push` to the connected branch triggers an automatic redeploy.

### Recommended repo layout (option A — cleanest)

Make `study-material/` the **root** of a dedicated GitHub repo. Then Vercel needs zero extra configuration.

### Option B — keep inside a monorepo

Push the parent repo; in Vercel set **Root Directory = `study-material`**. Vercel will only rebuild on changes within that folder if you set `Ignored Build Step` to:

```bash
git diff --quiet HEAD^ HEAD ./
```

## Stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · `react-markdown` · `remark-gfm` · `remark-math` + `rehype-katex` · `rehype-highlight` · Mermaid.
