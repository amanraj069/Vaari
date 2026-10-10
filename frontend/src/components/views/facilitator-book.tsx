"use client";

/** /dashboard/book for a helper: book fields for farmers one after another, with how it works and the latest bookings beside the form. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { bookingSchema, publicSummarySchema, queueItemSchema, slotLinkSchema, villageOptionSchema, type QueueItem } from "@/shared";
import { BookForm } from "@/components/book-form";
import { BookedList, type BookedListState } from "@/components/booked-list";
import { DashHeader, Panel } from "@/components/dashboard/kit";
import { ButtonLink } from "@/components/ui";
import { HowBookingWorks } from "@/components/how-booking-works";
import { useToast } from "@/components/toast";
import { api, copyText } from "@/lib/api";

const bookedSchema = z.object({ today: z.string(), items: z.array(queueItemSchema) });

/**
 * The fields this helper booked, kept fresh, with copying a farmer's link again and giving them a
 * new one. Shared by the booking page and the Bookings overview.
 */
export function useBookedList() {
  const t = useTranslations("book");
  const toast = useToast();
  const queryClient = useQueryClient();
  const booked = useQuery({ queryKey: ["facilitator-fields"], queryFn: () => api("facilitator/fields", bookedSchema), refetchInterval: 15_000 });

  const listState: BookedListState = booked.isPending
    ? { kind: "loading" }
    : booked.isError
      ? { kind: "error", onRetry: () => booked.refetch() }
      : { kind: "ready", items: [...booked.data.items].sort((left, right) => right.token - left.token) };

  async function copyLink(item: QueueItem) {
    try {
      const link = await api(`fields/${item.fieldId}/slot-link`, slotLinkSchema);
      await copyText(`${window.location.origin}${link.path}`);
      toast(t("copied"));
    } catch {
      toast(t("linkFailed"), "info");
    }
  }

  // A new link for a lost or over-shared one: the old link stops working at once. A failed reissue
  // reaches the dialog; once it has succeeded, a failed copy must not look like a failed reissue.
  async function reissueLink(item: QueueItem) {
    const link = await api(`fields/${item.fieldId}/slot-link/reissue`, slotLinkSchema, { method: "POST", body: "{}" });
    queryClient.invalidateQueries({ queryKey: ["facilitator-fields"] });
    const copied = await copyText(`${window.location.origin}${link.path}`).then(
      () => true,
      () => false,
    );
    toast(copied ? t("reissued") : t("reissuedNotCopied"));
  }

  return { booked, listState, copyLink, reissueLink };
}

export function FacilitatorBookView() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const villages = useQuery({ queryKey: ["villages"], queryFn: () => api("villages", z.array(villageOptionSchema)) });
  const summary = useQuery({ queryKey: ["public-summary"], queryFn: () => api("public/summary", publicSummarySchema), staleTime: 60_000 });
  const { listState, copyLink, reissueLink } = useBookedList();

  const t = useTranslations("bookings");
  const recent: BookedListState = listState.kind === "ready" ? { kind: "ready", items: listState.items.slice(0, 5) } : listState;

  return (
    <>
      <DashHeader
        title={t("bookTitle")}
        actions={
          <ButtonLink href="/dashboard" variant="secondary">
            {t("allBookings")}
            <ArrowRight aria-hidden className="size-4" strokeWidth={1.75} />
          </ButtonLink>
        }
      />
      {/* Booking on the left; how it works and the latest bookings on the right, so a helper books
          one farmer after another and checks the list as they go. */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <BookForm
          villages={villages.data ?? null}
          today={summary.data?.today ?? null}
          onSubmit={async (input) => {
            const booking = await api(`fields?lang=${locale}`, bookingSchema, { method: "POST", body: JSON.stringify(input) });
            queryClient.invalidateQueries({ queryKey: ["facilitator-fields"] });
            return booking;
          }}
        />
        <div className="space-y-6 xl:sticky xl:top-24">
          <Panel id="book-how-title" title={t("howTitle")}>
            <HowBookingWorks />
          </Panel>
          <Panel id="book-recent-title" title={t("recentTitle")} bodyClassName="">
            <BookedList bare state={recent} onCopyLink={copyLink} onReissueLink={reissueLink} />
          </Panel>
        </div>
      </div>
    </>
  );
}
