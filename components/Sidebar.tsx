"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Topic } from "@/lib/content";

export default function Sidebar({ topics }: { topics: Topic[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="lg:hidden fixed top-3 left-3 z-40 rounded border border-border bg-panel px-3 py-1.5 text-sm font-mono text-xs uppercase tracking-wider"
        aria-label="Toggle navigation"
      >
        {open ? "Close" : "Menu"}
      </button>

      <aside
        className={`${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 fixed lg:sticky top-0 left-0 z-30 h-screen w-72 shrink-0 border-r border-border bg-panel transition-transform sidebar-scroll overflow-y-auto`}
      >
        <div className="p-5">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="block text-xl font-serif font-bold mb-1 hover:text-accent transition"
          >
            Study Material
          </Link>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted mb-6">
            Interview Essentials
          </div>

          <nav className="space-y-5">
            {topics.map((t) => {
              const topicActive = pathname === `/${t.slug}`;
              return (
                <div key={t.slug}>
                  <Link
                    href={`/${t.slug}`}
                    onClick={() => setOpen(false)}
                    className={`block text-[10px] font-mono font-semibold uppercase tracking-[0.15em] mb-2 ${
                      topicActive ? "text-accent" : "text-muted hover:text-text"
                    }`}
                  >
                    {t.title}
                  </Link>
                  <ul className="space-y-1">
                    {t.articles.map((a) => {
                      const href = `/${t.slug}/${a.slug}`;
                      const active = pathname === href;
                      return (
                        <li key={a.slug}>
                          <Link
                            href={href}
                            onClick={() => setOpen(false)}
                            className={`block rounded px-2 py-1.5 text-sm transition ${
                              active
                                ? "bg-panel2 text-accent border-l-2 border-accent pl-3"
                                : "text-text/70 hover:bg-panel2 hover:text-text"
                            }`}
                          >
                            {a.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {topics.length === 0 && (
              <p className="text-sm text-muted">No topics yet.</p>
            )}
          </nav>
        </div>
      </aside>
    </>
  );
}
