"use client";

import { useEffect } from "react";

export default function ReadingProgress() {
  useEffect(() => {
    const bar = document.createElement("div");
    bar.id = "reading-progress";
    document.body.appendChild(bar);

    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      bar.style.width = `${pct}%`;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      bar.remove();
    };
  }, []);

  return null;
}
