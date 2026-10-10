/**
 * The picture half of AuthSplitLayout: wheat coming up through paddy stubble (sown, not burned),
 * with the promise in one line and the three things Vaari is for. All the words sit at the bottom
 * on a strong bottom-up wash of the page colour (photo-wash-auth), so every line reads at WCAG AA in
 * both themes, while the sprouts stay visible in the upper half. Labelled as an AI-generated
 * illustration, like /proof. The photo is scaled from its top-left corner so the generator's mark
 * in its bottom-right never shows. Decorative for screen readers: the same words are on the page.
 */
import { Satellite, Sprout, Wind } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

export async function AuthPhotoPanel() {
  const t = await getTranslations("landing");
  const tp = await getTranslations("proof");
  const points = [
    { icon: Wind, title: t("airTitle"), body: t("airBody") },
    { icon: Sprout, title: t("sowTitle"), body: t("sowBody") },
    { icon: Satellite, title: t("dataTitle"), body: t("dataBody") },
  ];
  return (
    <div className="relative isolate h-full overflow-hidden rounded-card border border-line">
      <div aria-hidden className="absolute inset-0 origin-top-left scale-[1.25]">
        <Image src="/auth/auth.png" alt="" fill sizes="(min-width: 1024px) 50vw, 1px" quality={80} className="object-cover" style={{ objectPosition: "40% 25%" }} />
      </div>
      <div aria-hidden className="photo-wash-auth absolute inset-0" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 p-8">
        <p className="font-display text-4xl leading-tight tracking-tight text-ink">
          {t.rich("heroTitle", { em: (chunks) => <em className="text-wheat-deep">{chunks}</em> })}
        </p>
        <p className="mt-3 max-w-md text-ink">{t("heroBody")}</p>
        <ul className="mt-6 grid gap-3">
          {points.map((point) => (
            <li key={point.title} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-surface">
                <point.icon className="size-5 text-wheat-deep" strokeWidth={1.5} />
              </span>
              <span className="text-sm">
                <span className="block font-medium text-ink">{point.title}</span>
                <span className="text-ink-muted">{point.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-ink-muted">{tp("heroPhoto")}</p>
      </div>
    </div>
  );
}
