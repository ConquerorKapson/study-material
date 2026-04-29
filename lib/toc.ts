export type Heading = { depth: number; text: string; id: string };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Extract H2/H3 headings from markdown for the right-side TOC.
// Skips fenced code blocks. Mirrors rehype-slug ID generation.
export function extractToc(markdown: string): Heading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Heading[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of lines) {
    const fence = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (line.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const depth = m[1].length;
    const text = m[2].replace(/`/g, "").trim();
    headings.push({ depth, text, id: slugify(text) });
  }
  return headings;
}
