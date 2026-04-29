import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import ReadingProgress from "@/components/ReadingProgress";
import { getTopics } from "@/lib/content";

export const metadata: Metadata = {
  title: "Study Material",
  description: "Personal SDE-2 / SDE-3 interview prep notes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const topics = getTopics();
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text">
        <ReadingProgress />
        <div className="flex">
          <Sidebar topics={topics} />
          <main className="flex-1 min-w-0">
            <div className="max-w-5xl mx-auto px-6 py-10">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
