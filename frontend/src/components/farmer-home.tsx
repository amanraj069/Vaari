"use client";

/**
 * /farmer: every field booked with the farmer's phone number, read-only. A farmer has no account:
 * they arrive from a one-time link (WhatsApp, or "Try as farmer"), which leaves a 7-day phone
 * session. Each field is a TokenCard with its date, status and history; nothing here changes a
 * booking (that is the field's own slot link, or the helper who booked it). With no session (or a
 * used or expired link) the page says how to get a new link: write "my fields" to Vaari on WhatsApp.
 */
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LinkIcon, LogOut, Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { farmerHomeSchema } from "@/shared";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { BrandMark } from "./brand-mark";
import { DateGuide } from "./farmer-aside";
import { LanguageMenu } from "./language-menu";
import { PAGE_FRAME, PageColumns, PageHeader } from "./page-shell";
import { SimulatedBadge } from "./simulated-badge";
import { ThemeToggle } from "./theme-toggle";
import { TokenCard } from "./token-card";
import { Button, Skeleton, StateMessage } from "./ui";
import { SeeAllMyFields } from "./whatsapp-link";

export type LinkProblem = "expired" | "unavailable" | null;

export function FarmerHomeView({ whatsappNumber, linkProblem }: { whatsappNumber: string | null; linkProblem: LinkProblem }) {
  const t = useTranslations("farmer");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dates = useDates();
  // Polling keeps the dates fresh when the operator publishes a plan (no websockets by design).
  const home = useQuery({
    queryKey: ["farmer-home", locale],
    queryFn: () => api(`farmer/home?lang=${locale}`, farmerHomeSchema, {}, { redirectOn401: false }),
    refetchInterval: 15_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
  const noSession = home.isError && home.error instanceof ApiError && home.error.status === 401;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/");
  }

  return (
    <>
      <header className="border-b border-line bg-paper/95">
        <div className={`flex items-center gap-3 py-3 sm:py-4 ${PAGE_FRAME}`}>
          <BrandMark />
          <div className="ml-auto flex items-center gap-1">
            <LanguageMenu />
            <ThemeToggle />
            {home.isSuccess ? (
              <Button variant="quiet" className="min-h-11" onClick={signOut}>
                <LogOut aria-hidden className="size-4" strokeWidth={1.75} />
                {tc("signOut")}
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <main className={`pb-16 pt-6 text-lg ${PAGE_FRAME}`}>
        {home.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <span className="sr-only" role="status">{tc("loading")}</span>
            <Skeleton className="h-9 w-2/3 max-w-sm" />
            <Skeleton className="h-96 max-w-2xl" />
          </div>
        ) : noSession ? (
          <div className="mx-auto max-w-xl">
            <StateMessage
              icon={linkProblem === "expired" ? LinkIcon : KeyRound}
              title={linkProblem === "expired" ? t("linkExpiredTitle") : t("noSessionTitle")}
              body={linkProblem === "expired" ? t("linkExpiredBody") : t("noSessionBody")}
              action={whatsappNumber ? <SeeAllMyFields number={whatsappNumber} /> : undefined}
            />
          </div>
        ) : home.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => home.refetch()}>{tc("retry")}</Button>} />
        ) : (
          <>
            <PageHeader
              className="mb-6"
              badge={<SimulatedBadge demoDate={dates.short(home.data.today)} />}
              title={home.data.farmerName ? t("greeting", { name: home.data.farmerName.split(" ")[0] ?? "" }) : t("allFieldsTitle")}
              description={t("readOnlyNote")}
            />
            <PageColumns
              main={
                home.data.fields.length === 0 ? (
                  <StateMessage icon={Sprout} title={t("noFieldsTitle")} body={t("noFieldsBody")} />
                ) : (
                  <ul className="space-y-5" aria-label={t("allFieldsTitle")}>
                    {home.data.fields.map((field) => (
                      <li key={`${field.chcId}/${field.id}`}>
                        <p className="mb-2 text-sm text-ink-muted">{field.chcName}</p>
                        <TokenCard field={field} today={home.data.today} operatorPhone={field.operatorPhone || undefined} whyPath={`farmer/fields/${field.chcId}/${field.id}/why`} />
                      </li>
                    ))}
                  </ul>
                )
              }
              aside={<DateGuide />}
            />
          </>
        )}
      </main>
    </>
  );
}
