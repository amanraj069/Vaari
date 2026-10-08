import type { Metadata } from "next";

// Hidden team page: not linked anywhere and kept out of search engines.
export const metadata: Metadata = { title: "Vaari design system", robots: { index: false, follow: false } };

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
