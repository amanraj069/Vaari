/**
 * AuthSplitLayout: the frame for the sign-in pages (/signin, /signin/<role>, /farmer/signin). Wide
 * screens (lg+): the visual on the left, the content on the right, in one grid row whose height
 * follows the viewport (between 640 and 820px; `compact`: between 560 and 720px) with both columns
 * stretched to it, so they are always exactly the same height; nothing inside has a fixed height.
 *   panel="card"  the content sits in one card, centred vertically (forms)
 *   panel="bare"  the content brings its own cards and runs top to bottom (the chooser, whose last
 *                 block is pinned to the bottom with mt-auto)
 * Narrower: one column, the content first; the visual is left out, or (visualBelow) follows the
 * content, for a visual that carries an action (the farmer's "Open WhatsApp").
 * No visual (null): the content alone, one centred column at every width, never an empty half.
 */
import type { ReactNode } from "react";

export function AuthSplitLayout({
  visual,
  children,
  panel = "card",
  visualBelow = false,
  compact = false,
}: {
  visual: ReactNode | null;
  children: ReactNode;
  panel?: "card" | "bare";
  visualBelow?: boolean;
  compact?: boolean;
}) {
  const height = compact ? "lg:min-h-[clamp(560px,calc(100dvh-12rem),720px)]" : "lg:min-h-[clamp(640px,calc(100dvh-9rem),820px)]";
  return (
    <div className={`grid gap-8 ${height} lg:items-stretch lg:gap-10 ${visual ? "lg:grid-cols-2" : "mx-auto w-full max-w-xl"}`}>
      {visual ? <div className={`${visualBelow ? "order-2 lg:order-1" : "hidden lg:block"} h-full min-w-0`}>{visual}</div> : null}
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
