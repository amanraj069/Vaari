/**
 * The frame both staff sign-in pages share (/signin and /signin/<role>): the top bar, and
 * AuthSplitLayout with the photo on the left. Because it is a layout, the photo stays in place when
 * the person moves between the two pages; only the right-hand side changes, and template.tsx fades
 * it in. Each page draws its own right-hand side (/signin its two audiences, /signin/<role> a card).
 */
import type { ReactNode } from "react";
import { AuthPhotoPanel } from "@/components/auth-photo-panel";
import { AuthSplitLayout } from "@/components/auth-split-layout";
import { PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";

export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <PageMain>
        <AuthSplitLayout visual={<AuthPhotoPanel />} panel="bare">
          {children}
        </AuthSplitLayout>
      </PageMain>
    </>
  );
}
