import type { Metadata } from "next";
import { PRIVATE_PAGE_METADATA } from "@/lib/private-pages";

// A slot link carries its permission in the URL: never indexed, never sent on as a referrer.
export const metadata: Metadata = PRIVATE_PAGE_METADATA;

export default function SlotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
