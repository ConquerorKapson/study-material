"use client";

import { useEffect, useState } from "react";
import type { Heading } from "@/lib/toc";

export default function TOC({ headings }: { headings: Heading[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0.1 }
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        On this page
      </div>
      <ul className="space-y-1.5 border-l border-border">
        {headings.map((h) => (
          <li
            key={h.id}
            style={{ paddingLeft: `${(h.depth - 2) * 12 + 12}px` }}
          >
            <a
              href={`#${h.id}`}
              className={`block transition border-l-2 -ml-px pl-3 py-0.5 ${
                activeId === h.id
                  ? "text-accent2 border-accent2"
                  : "text-muted border-transparent hover:text-text"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
