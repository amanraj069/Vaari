"use client";

/**
 * /farmer: every field booked with the farmer's phone number, with "Book a new field" beside them.
 * A farmer arrives signed in with a code on WhatsApp (/farmer/signin) or from a one-time link
 * (WhatsApp, or "Try as farmer"); both leave a 7-day phone session. Each field is a TokenCard with
 * its date, status and history; changing a booking is that field's own slot link, or the helper
 * who booked it. With no session (or a used or expired link) the page offers phone sign-in and
 * "my fields" on WhatsApp. Beside the list: everything also works on WhatsApp, starting with "hey".
 */
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LinkIcon, Plus, Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { farmerHomeSchema } from "@/shared";
import { ApiError, api } from "@/lib/api";
import { useDates } from "@/lib/dates";
import { DateGuide } from "./farmer-aside";
import { FarmerHeader } from "./farmer-header";
import { FarmerNameForm } from "./farmer-name-form";
import { PAGE_FRAME, PageColumns, PageHeader } from "./page-shell";
import { SimulatedBadge } from "./simulated-badge";
import { TokenCard } from "./token-card";
import { Button, ButtonLink, Skeleton, StateMessage } from "./ui";
import { SeeAllMyFields } from "./whatsapp-link";
import { WhatsAppStart } from "./whatsapp-start";

export type LinkProblem = "expired" | "unavailable" | null;

export function FarmerHomeView({ whatsappNumber, linkProblem }: { whatsappNumber: string | null; linkProblem: LinkProblem }) {
  const t = useTranslations("farmer");
  const tc = useTranslations("common");
  const ts = useTranslations("farmerSignin");
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
  const newBooking = (
    <ButtonLink href="/farmer/new" variant="accent" className="min-h-12">
      <Plus aria-hidden className="size-5" strokeWidth={2} />
      {t("newBooking")}
    </ButtonLink>
  );

  return (
    <>
      <FarmerHeader signedIn={home.isSuccess} />
      <main className={`pb-16 pt-8 sm:pt-10 text-lg ${PAGE_FRAME}`}>
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
              action={
                <div className="grid gap-4">
                  <ButtonLink href="/farmer/signin" variant="accent" className="min-h-12 w-full">
                    <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
                    {t("signInAction")}
                  </ButtonLink>
                  {whatsappNumber ? <SeeAllMyFields number={whatsappNumber} /> : null}
                </div>
              }
            />
          </div>
        ) : home.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => home.refetch()}>{tc("retry")}</Button>} />
        ) : !home.data.registered ? (
          // Signed in with a code but left before giving a name: finish here, then see the page.
          <section aria-labelledby="finish-title" className="mx-auto max-w-xl rounded-card border border-line bg-surface p-5 sm:p-6">
            <h1 id="finish-title" className="font-display text-3xl leading-tight">
              {t("finishTitle")}
            </h1>
            <p className="mb-5 mt-2 text-ink-muted">{ts("nameBody")}</p>
            <FarmerNameForm onDone={() => home.refetch()} />
          </section>
        ) : (
          <>
            <PageHeader
              className="mb-6"
              badge={<SimulatedBadge demoDate={dates.short(home.data.today)} />}
              title={home.data.farmerName ? t("greeting", { name: home.data.farmerName.split(" ")[0] ?? "" }) : t("allFieldsTitle")}
              description={t("readOnlyNote")}
              actions={newBooking}
            />
            <PageColumns
              main={
                home.data.fields.length === 0 ? (
                  <StateMessage icon={Sprout} title={t("noFieldsTitle")} body={t("noFieldsBody")} action={newBooking} />
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
              aside={
                <div className="space-y-5">
                  <WhatsAppStart number={whatsappNumber} />
                  <DateGuide />
                </div>
              }
            />
          </>
        )}
      </main>
    </>
  );
}
