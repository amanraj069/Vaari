/**
 * Above the farmer sign-in form, why the farmer is here: their WhatsApp login link was used or has
 * expired, Vaari could not be reached when they tapped it, or their 7-day sign-in ended. Plain
 * words and what to do next; never a status code.
 */
import { CloudOff, KeyRound, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export type FarmerLinkProblem = "expired" | "unavailable" | "ended";

export function parseLinkProblem(value: string | undefined): FarmerLinkProblem | null {
  return value === "expired" || value === "unavailable" || value === "ended" ? value : null;
}

export function FarmerLinkNotice({ problem }: { problem: FarmerLinkProblem }) {
  const t = useTranslations("farmer");
  const Icon = problem === "expired" ? LinkIcon : problem === "ended" ? KeyRound : CloudOff;
  const title = problem === "expired" ? t("linkExpiredTitle") : problem === "ended" ? t("sessionEndedTitle") : t("linkUnavailableTitle");
  const body = problem === "expired" ? t("linkExpiredBody") : problem === "ended" ? t("sessionEndedBody") : t("linkUnavailableBody");
  return (
    <div role="status" className="flex gap-3 rounded-card border border-wheat-deep/30 bg-wheat-soft/60 p-4">
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{body}</p>
      </div>
    </div>
  );
}
