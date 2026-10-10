/**
 * AuthSplitLayout: the frame for the sign-in pages (/signin, /signin/<role>, /farmer/signin). Wide
 * screens (lg+): the visual on the left, the content on the right, in one grid row whose height
 * follows the viewport (between 640 and 820px) with both columns stretched to it, so they are
 * always exactly the same height; nothing inside has a fixed height.
 *   panel="card"  the content sits in one card, centred vertically (forms)
 *   panel="bare"  the content brings its own cards and runs top to bottom (the chooser, whose last
 *                 block is pinned to the bottom with mt-auto)
 * Narrower: one column, the content first; the visual is left out, or (visualBelow) follows the
 * content, for a visual that carries an action (the farmer's "Open WhatsApp").
 */
import type { ReactNode } from "react";

export function AuthSplitLayout({ visual, children, panel = "card", visualBelow = false }: { visual: ReactNode; children: ReactNode; panel?: "card" | "bare"; visualBelow?: boolean }) {
  return (
    <div className="grid gap-8 lg:min-h-[clamp(640px,calc(100dvh-9rem),820px)] lg:grid-cols-2 lg:items-stretch lg:gap-10">
      <div className={`${visualBelow ? "order-2 lg:order-1" : "hidden lg:block"} h-full min-w-0`}>{visual}</div>
      <div className="order-1 h-full min-w-0 lg:order-2">
        {panel === "card" ? (
          <div className="flex h-full flex-col justify-center rounded-card border border-line bg-surface p-5 sm:px-8 sm:py-7">{children}</div>
        ) : (
          <div className="flex h-full flex-col">{children}</div>
        )}
      </div>
    </div>
  );
}
