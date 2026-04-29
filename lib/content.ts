import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Folders that are NOT topic folders (Next.js / tooling).
const RESERVED = new Set([
  "app",
  "components",
  "lib",
  "public",
  "node_modules",
  ".next",
  ".vercel",
  ".git",
  ".github",
  "styles",
]);

export type ArticleMeta = {
  topic: string;
  slug: string;
  title: string;
  description?: string;
  order?: number;
  filepath: string;
};

export type Topic = {
  slug: string;
  title: string;
  articles: ArticleMeta[];
};

const ROOT = process.cwd();

function titleize(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\.md$/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readArticle(topic: string, file: string): ArticleMeta {
  const filepath = path.join(ROOT, topic, file);
  const raw = fs.readFileSync(filepath, "utf8");
  const { data } = matter(raw);
  const slug = file.replace(/\.md$/i, "");
  return {
    topic,
    slug,
    title: (data.title as string) || titleize(file),
    description: (data.description as string) || undefined,
    order: typeof data.order === "number" ? data.order : undefined,
    filepath,
  };
}

export function getTopics(): Topic[] {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  const topics: Topic[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (RESERVED.has(e.name)) continue;

    const topicDir = path.join(ROOT, e.name);
    const files = fs
      .readdirSync(topicDir)
      .filter((f) => f.toLowerCase().endsWith(".md"));
    if (files.length === 0) continue;

    const articles = files
      .map((f) => readArticle(e.name, f))
      .sort((a, b) => {
        if (a.order != null && b.order != null) return a.order - b.order;
        if (a.order != null) return -1;
        if (b.order != null) return 1;
        return a.title.localeCompare(b.title);
      });

    topics.push({
      slug: e.name,
      title: titleize(e.name),
      articles,
    });
  }

  topics.sort((a, b) => a.title.localeCompare(b.title));
  return topics;
}

export function getArticle(topic: string, slug: string): {
  meta: ArticleMeta;
  content: string;
} | null {
  const filepath = path.join(ROOT, topic, `${slug}.md`);
  if (!fs.existsSync(filepath)) return null;
  const raw = fs.readFileSync(filepath, "utf8");
  const { data, content } = matter(raw);
  return {
    meta: {
      topic,
      slug,
      title: (data.title as string) || titleize(`${slug}.md`),
      description: (data.description as string) || undefined,
      order: typeof data.order === "number" ? data.order : undefined,
      filepath,
    },
    content,
  };
}

export function getAllArticleParams(): { topic: string; slug: string }[] {
  return getTopics().flatMap((t) =>
    t.articles.map((a) => ({ topic: t.slug, slug: a.slug }))
  );
}
