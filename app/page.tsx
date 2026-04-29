import Link from "next/link";
import { getTopics } from "@/lib/content";

export default function HomePage() {
  const topics = getTopics();
  const total = topics.reduce((n, t) => n + t.articles.length, 0);

  return (
    <div>
      <header className="mb-10">
        <h1 className="text-4xl font-bold mb-2">Study Material</h1>
        <p className="text-muted">
          {topics.length} topic{topics.length === 1 ? "" : "s"} · {total} article
          {total === 1 ? "" : "s"}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {topics.map((t) => (
          <Link
            key={t.slug}
            href={`/${t.slug}`}
            className="block rounded-lg border border-border bg-panel p-5 hover:border-accent transition"
          >
            <div className="text-xl font-semibold mb-1">{t.title}</div>
            <div className="text-sm text-muted">
              {t.articles.length} article{t.articles.length === 1 ? "" : "s"}
            </div>
          </Link>
        ))}
        {topics.length === 0 && (
          <p className="text-muted">
            No topics yet. Add a folder with a <code>.md</code> file alongside this app.
          </p>
        )}
      </div>
    </div>
  );
}
