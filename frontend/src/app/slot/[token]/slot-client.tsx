"use client";

/**
 * /slot/[token]: a farmer's turn, opened from a link with no sign-in. The token is the permission
 * (it names one field and its link version). Polls so the date updates by itself after the operator
 * approves a plan. "See all my fields" opens WhatsApp to ask Vaari for a link to every field booked
 * with the farmer's number.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { farmerFieldSchema, publicSummarySchema, whySchema } from "@/shared";
import { PAGE_FRAME } from "@/components/page-shell";
import { BrandMark } from "@/components/brand-mark";
import { LanguageMenu } from "@/components/language-menu";
import { SlotView, type SlotState, type WhyState } from "@/components/slot-view";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/components/toast";
import { ApiError, api } from "@/lib/api";

const NO_REDIRECT = { redirectOn401: false } as const;

export function SlotPageClient({ whatsappNumber }: { whatsappNumber: string | null }) {
  const { token } = useParams<{ token: string }>();
  const locale = useLocale();
  const t = useTranslations("slot");
  const toast = useToast();
  const queryClient = useQueryClient();
  const path = `slot/${encodeURIComponent(token)}`;

  // The reason sentence comes from the backend in the reader's language.
  const slot = useQuery({
    queryKey: ["slot", token, locale],
    queryFn: () => api(`${path}?lang=${locale}`, farmerFieldSchema, {}, NO_REDIRECT),
    refetchInterval: 15_000,
    // A bad or foreign link will not get better by retrying.
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
  });
  const summary = useQuery({ queryKey: ["public-summary"], queryFn: () => api("public/summary", publicSummarySchema, {}, NO_REDIRECT), staleTime: 60_000 });
  const why = useQuery({
    queryKey: ["slot-why", token, locale, JSON.stringify(slot.data?.promise ?? null)],
    queryFn: () => api(`${path}/why?lang=${locale}`, whySchema, {}, NO_REDIRECT),
    // Only a promised date has a "why": a request waits for the operator's plan.
    enabled: slot.isSuccess && (slot.data.status === "firm" || slot.data.status === "window"),
  });
  const [cancelled, setCancelled] = useState(false);
  const shorten = useMutation({
    mutationFn: (waitingLimitDays: number) =>
      api(`${path}/waiting-limit?lang=${locale}`, farmerFieldSchema, { method: "POST", body: JSON.stringify({ waitingLimitDays }) }, NO_REDIRECT),
    onSuccess: (field) => {
      queryClient.setQueryData(["slot", token, locale], field);
      queryClient.invalidateQueries({ queryKey: ["slot-why", token] });
      toast(t("updated"));
    },
  });

  let state: SlotState;
  if (cancelled) state = { kind: "cancelled" };
  else if (slot.isPending) state = { kind: "loading" };
  else if (slot.isError) {
    const status = slot.error instanceof ApiError ? slot.error.status : 0;
    state = status === 401 ? { kind: "invalid" } : status === 403 ? { kind: "forbidden" } : status === 404 ? { kind: "notFound" } : { kind: "unavailable", onRetry: () => slot.refetch() };
  } else {
    const promised = slot.data.status === "firm" || slot.data.status === "window";
    const whyState: WhyState = !promised
      ? { kind: "none" }
      : why.isSuccess
        ? { kind: "ready", reasons: why.data.reasons.map((reason) => reason.text) }
        : why.isError
          ? { kind: "error" }
          : { kind: "loading" };
    state = {
      kind: "ready",
      field: slot.data,
      today: summary.data?.today ?? null,
      why: whyState,
      onCannotWait: async (days) => {
        await shorten.mutateAsync(days);
      },
      changeBase: path,
      onChanged: (change) => {
        if (change === "cancel") setCancelled(true);
        else {
          queryClient.invalidateQueries({ queryKey: ["slot", token] });
          toast(t("updated"));
        }
      },
    };
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className={`flex min-h-16 items-center gap-3 py-2 sm:py-3 ${PAGE_FRAME}`}>
          <BrandMark />
          <div className="ml-auto flex items-center gap-1">
            <LanguageMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={`pb-16 ${PAGE_FRAME}`}>
        <SlotView state={state} whatsappNumber={whatsappNumber} />
      </main>
    </>
  );
}
