"use client";

/** /book: a facilitator books fields for farmers and keeps track of them. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { bookingSchema, publicSummarySchema, queueItemSchema, slotLinkSchema, villageOptionSchema, type QueueItem } from "@/shared";
import { BookForm } from "@/components/book-form";
import { BookedList, type BookedListState } from "@/components/booked-list";
import { SimulatedBadge } from "@/components/simulated-badge";
import { useToast } from "@/components/toast";
import { PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { api, copyText } from "@/lib/api";

const bookedSchema = z.object({ today: z.string(), items: z.array(queueItemSchema) });

export default function BookPage() {
  const t = useTranslations("book");
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const villages = useQuery({ queryKey: ["villages"], queryFn: () => api("villages", z.array(villageOptionSchema)) });
  const summary = useQuery({ queryKey: ["public-summary"], queryFn: () => api("public/summary", publicSummarySchema), staleTime: 60_000 });
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

  return (
    <>
      <TopBar />
      <PageMain>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <SimulatedBadge />
        </div>
        {/* Booking on the left, everyone already booked on the right: a helper books one farmer
            after another and checks the list as they go. */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
          <BookForm
            villages={villages.data ?? null}
            today={summary.data?.today ?? null}
            onSubmit={async (input) => {
              const booking = await api(`fields?lang=${locale}`, bookingSchema, { method: "POST", body: JSON.stringify(input) });
              queryClient.invalidateQueries({ queryKey: ["facilitator-fields"] });
              return booking;
            }}
          />
          <div className="lg:sticky lg:top-6">
            <BookedList state={listState} onCopyLink={copyLink} />
          </div>
        </div>
      </PageMain>
    </>
  );
}
