"use client";

/** Farmer home: one idea per screen, answer first. Each field is a TokenCard with its date. */
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { farmerHomeSchema } from "@/shared";
import { SimulatedBadge } from "@/components/simulated-badge";
import { TokenCard } from "@/components/token-card";
import { TopBar } from "@/components/top-bar";
import { Button, ButtonLink, Skeleton, StateMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { useDates } from "@/lib/dates";

export default function FarmerHomePage() {
  const t = useTranslations("farmer");
  const tc = useTranslations("common");
  const dates = useDates();
  // Polling keeps the date fresh when the operator re-plans (no websockets by design).
  const home = useQuery({ queryKey: ["farmer-home"], queryFn: () => api("farmer/home", farmerHomeSchema), refetchInterval: 5_000 });

  return (
    <>
      <TopBar signedIn />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-6 text-lg">
        {home.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-96" />
          </div>
        ) : home.isError ? (
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => home.refetch()}>{tc("retry")}</Button>} />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <h1 className="font-display text-3xl">{t("greeting", { name: home.data.farmerName.split(" ")[0] ?? "" })}</h1>
              <SimulatedBadge demoDate={dates.short(home.data.today)} />
            </div>
            {home.data.fields.length === 0 ? (
              <StateMessage
                title={t("emptyTitle")}
                body={t("emptyBody")}
                action={
                  <ButtonLink href="/farmer/request" variant="accent" className="min-h-12 text-lg">
                    <Plus aria-hidden className="size-5" strokeWidth={1.75} />
                    {t("addField")}
                  </ButtonLink>
                }
              />
            ) : (
              <div className="space-y-5">
                {home.data.fields.map((field) => (
                  <TokenCard key={field.id} field={field} today={home.data.today} operatorPhone={home.data.operatorPhone} />
                ))}
                <ButtonLink href="/farmer/request" variant="secondary" className="min-h-12 w-full text-lg">
                  <Plus aria-hidden className="size-5" strokeWidth={1.75} />
                  {t("addAnother")}
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
