import type { Metadata } from "next";
import { PRIVATE_PAGE_METADATA } from "@/lib/private-pages";

// One farmer's fields, behind a phone session: never indexed, never sent on as a referrer.
export const metadata: Metadata = PRIVATE_PAGE_METADATA;

export default function FarmerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
