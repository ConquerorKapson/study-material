import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllArticleParams, getArticle } from "@/lib/content";
import { extractToc } from "@/lib/toc";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import TOC from "@/components/TOC";

export function generateStaticParams() {
  return getAllArticleParams();
}

export default function ArticlePage({
  params,
}: {
  params: { topic: string; slug: string };
}) {
  const article = getArticle(params.topic, params.slug);
  if (!article) notFound();

  const headings = extractToc(article.content);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-10">
      <article className="min-w-0">
        <nav className="text-sm text-muted mb-4">
          <Link href="/" className="hover:text-text">
            Home
          </Link>{" "}
          /{" "}
          <Link href={`/${params.topic}`} className="hover:text-text capitalize">
            {params.topic}
          </Link>{" "}
          / <span className="text-text">{article.meta.title}</span>
        </nav>

        <div className="prose prose-invert max-w-none prose-tweaks">
          <MarkdownRenderer source={article.content} />
        </div>
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <TOC headings={headings} />
        </div>
      </aside>
    </div>
  );
}
