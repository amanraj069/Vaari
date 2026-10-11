"use client";

/**
 * /dashboard/book for a farmer: a registered farmer books a field for themselves. Needs the phone session; without it
 * the page says how to sign in. The villages on offer are every village a machine centre serves.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { bookingSchema, farmerBookingOptionsSchema, type FieldRequestInput } from "@/shared";
import { ApiError, api } from "@/lib/api";
import { BackButton } from "./back-button";
import { DateGuide } from "./farmer-aside";
import { FarmerTicketForm } from "./farmer-ticket-form";
import { PageColumns, PageHeader } from "./page-shell";
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
      <div className="text-base sm:text-lg">
        {noSession ? (
          <div className="mx-auto max-w-xl">
            <StateMessage
              icon={KeyRound}
              title={t("signInTitle")}
              body={t("signInBody")}
              action={
                <ButtonLink href="/farmer/signin?next=/dashboard/book" variant="accent" className="min-h-12">
                  {tf("signInAction")}
                </ButtonLink>
              }
            />
          </div>
        ) : options.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => options.refetch()}>{tc("retry")}</Button>} />
        ) : (
          <>
            <PageHeader className="mb-6" back={<BackButton fallback="/dashboard" />} title={t("title")} description={t("subtitle")} shortDescription={t("subtitleShort")} />
            <PageColumns
              main={options.isPending ? <Skeleton className="h-96" /> : <FarmerTicketForm villages={options.data.villages} today={options.data.today} onSubmit={book} />}
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
