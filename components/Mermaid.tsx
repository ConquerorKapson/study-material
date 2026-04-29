"use client";

import { useEffect, useId, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

export default function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        try {
          const { svg } = await mermaid.render(`m-${id}`, chart);
          if (!cancelled && ref.current) ref.current.innerHTML = svg;
        } catch (e: unknown) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="mermaid-container text-red-400 text-sm whitespace-pre-wrap">
        Mermaid error: {error}
        {"\n\n"}
        {chart}
      </pre>
    );
  }
  return <div ref={ref} className="mermaid-container" />;
}
