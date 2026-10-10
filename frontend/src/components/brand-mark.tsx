/**
 * The platform mark: the harvester icon to the left of the wordmark. Both images are rendered and
 * CSS shows the right one (icon.png in light mode, icon-d.png in dark), so it never flashes.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";

/** `compact`: the harvester alone (the collapsed sidebar). */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("common");
  return (
    <Link href="/" className={`group inline-flex min-h-11 shrink-0 items-center gap-1.5 sm:gap-2 ${compact ? "min-w-11 justify-center" : ""}`} aria-label={t("brandHome")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed small mark gains nothing from next/image */}
      <img src="/icon.png" alt="" aria-hidden="true" width={44} height={32} className="block h-7 w-auto object-contain sm:h-8 dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img src="/icon-d.png" alt="" aria-hidden="true" width={44} height={32} className="hidden h-7 w-auto object-contain sm:h-8 dark:block" />
      {compact ? null : (
        <>
          <span className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Vaari</span>
          <span lang="pa" className="hidden text-lg text-wheat-deep min-[400px]:inline">ਵਾਰੀ</span>
        </>
      )}
    </Link>
  );
}
