"use client";

/**
 * /dashboard for a farmer: every field booked with their phone number, with "Book a new field"
 * beside them. A farmer arrives signed in with a code on WhatsApp (/farmer/signin) or from a
 * one-time link (WhatsApp, or "Try as farmer"); both leave a 7-day phone session. Each field is a
 * TokenCard with its date, status and history; changing a booking is that field's own slot link,
 * or the helper who booked it. If the session ends while the page is open, it offers phone sign-in
 * and "my fields" on WhatsApp. Beside the list: everything also works on WhatsApp.
 */
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { farmerHomeSchema } from "@/shared";
import { ApiError, api } from "@/lib/api";
import { DateGuide } from "./farmer-aside";
import { FarmerNameForm } from "./farmer-name-form";
import { PageColumns, PageHeader } from "./page-shell";
import { TokenCard } from "./token-card";
import { Button, ButtonLink, Skeleton, StateMessage } from "./ui";
import { SeeAllMyFields } from "./whatsapp-link";
import { WhatsAppStart } from "./whatsapp-start";

export function FarmerHomeView({ whatsappNumber }: { whatsappNumber: string | null }) {
  const t = useTranslations("farmer");
  const tc = useTranslations("common");
  const ts = useTranslations("farmerSignin");
  const locale = useLocale();
  // Polling keeps the dates fresh when the operator publishes a plan (no websockets by design).
  const home = useQuery({
    queryKey: ["farmer-home", locale],
    queryFn: () => api(`farmer/home?lang=${locale}`, farmerHomeSchema, {}, { redirectOn401: false }),
    refetchInterval: 15_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
  const noSession = home.isError && home.error instanceof ApiError && home.error.status === 401;
  const newBooking = (
    <ButtonLink href="/dashboard/book" variant="accent" className="min-h-12 w-full sm:w-auto">
      <Plus aria-hidden className="size-5" strokeWidth={2} />
      {t("newBooking")}
    </ButtonLink>
  );

  return (
    <>
      <div className="text-base sm:text-lg">
        {home.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <span className="sr-only" role="status">{tc("loading")}</span>
            <Skeleton className="h-9 w-2/3 max-w-sm" />
            <Skeleton className="h-96 max-w-2xl" />
          </div>
        ) : noSession ? (
          <div className="mx-auto max-w-xl">
            <StateMessage
              icon={KeyRound}
              title={t("noSessionTitle")}
              body={t("noSessionBody")}
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
              className="mb-6 sm:mb-8"
              title={home.data.farmerName ? t("greeting", { name: home.data.farmerName.split(" ")[0] ?? "" }) : t("allFieldsTitle")}
              description={t("readOnlyNote")}
              shortDescription={t("readOnlyNoteShort")}
              actions={newBooking}
            />
            <PageColumns
              main={
                home.data.fields.length === 0 ? (
                  <StateMessage icon={Sprout} title={t("noFieldsTitle")} body={t("noFieldsBody")} action={newBooking} />
                ) : (
                  <ul className="space-y-4 sm:space-y-5" aria-label={t("allFieldsTitle")}>
                    {home.data.fields.map((field) => (
                      <li key={`${field.chcId}/${field.id}`}>
                        <TokenCard
                          field={field}
                          today={home.data.today}
                          centreName={field.chcName}
                          operatorPhone={field.operatorPhone || undefined}
                          whyPath={`farmer/fields/${field.chcId}/${field.id}/why`}
                        />
                      </li>
                    ))}
                  </ul>
                )
              }
              aside={
                // Tablets: the two help cards side by side under the task instead of one long column.
                <div className="grid items-start gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
                  <WhatsAppStart number={whatsappNumber} />
                  <DateGuide />
                </div>
              }
            />
          </>
        )}
      </div>
    </>
  );
}
