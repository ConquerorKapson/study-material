import Link from "next/link";
import { notFound } from "next/navigation";
import { getTopics } from "@/lib/content";

export function generateStaticParams() {
  return getTopics().map((t) => ({ topic: t.slug }));
}

export default function TopicPage({ params }: { params: { topic: string } }) {
  const topic = getTopics().find((t) => t.slug === params.topic);
  if (!topic) notFound();

  return (
    <div>
      <nav className="text-sm text-muted mb-4">
        <Link href="/" className="hover:text-text">
          Home
        </Link>{" "}
        / <span className="text-text">{topic.title}</span>
      </nav>
      <h1 className="text-3xl font-bold mb-6">{topic.title}</h1>
      <ul className="space-y-3">
        {topic.articles.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/${topic.slug}/${a.slug}`}
              className="block rounded-lg border border-border bg-panel p-4 hover:border-accent transition"
            >
              <div className="font-semibold">{a.title}</div>
              {a.description && (
                <div className="text-sm text-muted mt-1">{a.description}</div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
