/**
 * First stop after a new Google sign-in: pick a role and a CHC (and language), so the API knows
 * which records this person works with. Already set-up users are sent straight to their page.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { chcOptionSchema, localeSchema, meSchema } from "@/shared";
import { PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { WelcomeForm } from "@/components/welcome-form";
import { COOKIE, serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

export default async function WelcomePage() {
  const meResponse = await apiFetch("/me").catch(() => null);
  const me = meResponse?.ok ? meSchema.safeParse(await meResponse.json()) : null;
  if (!me?.success) redirect("/signin");
  // Already set up: go through /api/auth/resume, which also corrects a stale role cookie.
  if (!me.data.needsOnboarding && me.data.role) redirect("/api/auth/resume");

  const chcResponse = await apiFetch("/chcs").catch(() => null);
  const chcs = chcResponse?.ok ? z.array(chcOptionSchema).parse(await chcResponse.json()) : [];
  const jar = await cookies();
  const suggestedName = jar.get(COOKIE.displayName)?.value ?? (me.data.name.includes("@") ? "" : me.data.name);
  // The role picked on /signin: helpers and officers are told how their access is granted.
  const picked = jar.get(COOKIE.rolePick)?.value;

  return (
    <>
      <TopBar />
      <PageMain measure="center">
        <WelcomeForm
          chcs={chcs}
          suggestedName={suggestedName}
          currentRole={me.data.role}
          locale={localeSchema.catch("en").parse(await getLocale())}
          operatorSelfService={serverConfig.demoMode}
          pickedRole={picked === "helper" || picked === "officer" ? picked : null}
        />
      </PageMain>
    </>
  );
}
