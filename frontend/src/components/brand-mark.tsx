/**
 * The platform mark: the harvester icon to the left of the wordmark. Both images are rendered and
 * CSS shows the right one (icon.png in light mode, icon-d.png in dark), so it never flashes.
 */
import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2" aria-label="Vaari home">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed small mark gains nothing from next/image */}
      <img src="/icon.png" alt="" aria-hidden="true" width={44} height={32} className="block h-8 w-auto object-contain dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img src="/icon-d.png" alt="" aria-hidden="true" width={44} height={32} className="hidden h-8 w-auto object-contain dark:block" />
      <span className="font-display text-2xl font-semibold tracking-tight">Vaari</span>
      <span lang="pa" className="text-lg text-wheat-deep">ਵਾਰੀ</span>
    </Link>
  );
}
