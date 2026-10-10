"use client";

/**
 * /farmer/new: a registered farmer books a field for themselves. Needs the phone session; without it
 * the page says how to sign in. The villages on offer are every village a machine centre serves.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { bookingSchema, farmerBookingOptionsSchema, type FieldRequestInput } from "@/shared";
import { ApiError, api } from "@/lib/api";
import { BackButton } from "./back-button";
import { DateGuide } from "./farmer-aside";
import { FarmerHeader } from "./farmer-header";
import { FarmerTicketForm } from "./farmer-ticket-form";
import { PAGE_FRAME, PageColumns, PageHeader } from "./page-shell";
import { Button, ButtonLink, Skeleton, StateMessage } from "./ui";
import { WhatsAppStart } from "./whatsapp-start";

export function FarmerNewView({ whatsappNumber }: { whatsappNumber: string | null }) {
  const t = useTranslations("farmerNew");
  const tc = useTranslations("common");
  const tf = useTranslations("farmer");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: ["farmer-booking-options"],
    queryFn: () => api("farmer/booking-options", farmerBookingOptionsSchema, {}, { redirectOn401: false }),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
  const noSession = options.isError && options.error instanceof ApiError && options.error.status === 401;

  async function book(input: FieldRequestInput) {
    const booking = await api(`farmer/fields?lang=${locale}`, bookingSchema, { method: "POST", body: JSON.stringify(input) }, { redirectOn401: false });
    await queryClient.invalidateQueries({ queryKey: ["farmer-home"] });
    return booking;
  }

  return (
    <>
      <FarmerHeader signedIn={options.isSuccess} />
      <main className={`pb-16 pt-8 sm:pt-10 text-lg ${PAGE_FRAME}`}>
        {noSession ? (
          <div className="mx-auto max-w-xl">
            <StateMessage
              icon={KeyRound}
              title={t("signInTitle")}
              body={t("signInBody")}
              action={
                <ButtonLink href="/farmer/signin?next=/farmer/new" variant="accent" className="min-h-12">
                  {tf("signInAction")}
                </ButtonLink>
              }
            />
          </div>
        ) : options.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => options.refetch()}>{tc("retry")}</Button>} />
        ) : (
          <>
            <PageHeader className="mb-6" back={<BackButton fallback="/farmer" />} title={t("title")} description={t("subtitle")} />
            <PageColumns
              main={options.isPending ? <Skeleton className="h-96" /> : <FarmerTicketForm villages={options.data.villages} today={options.data.today} onSubmit={book} />}
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
