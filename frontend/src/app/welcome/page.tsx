/**
 * First stop after a new Google sign-in: pick a role and a CHC (and language), so the API knows
 * which records this person works with. Already set-up users are sent straight to their page.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { chcOptionSchema, localeSchema, meSchema } from "@/shared";
import { TopBar } from "@/components/top-bar";
import { WelcomeForm } from "@/components/welcome-form";
import { COOKIE, ROLE_HOME, serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

export default async function WelcomePage() {
  const meResponse = await apiFetch("/me").catch(() => null);
  const me = meResponse?.ok ? meSchema.safeParse(await meResponse.json()) : null;
  if (!me?.success) redirect("/signin");
  if (!me.data.needsOnboarding && me.data.role) redirect(ROLE_HOME[me.data.role] ?? "/");

  const chcResponse = await apiFetch("/chcs").catch(() => null);
  const chcs = chcResponse?.ok ? z.array(chcOptionSchema).parse(await chcResponse.json()) : [];
  const suggestedName = (await cookies()).get(COOKIE.displayName)?.value ?? (me.data.name.includes("@") ? "" : me.data.name);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-10">
        <WelcomeForm
          chcs={chcs}
          suggestedName={suggestedName}
          currentRole={me.data.role}
          locale={localeSchema.catch("en").parse(await getLocale())}
          operatorSelfService={serverConfig.demoMode}
        />
      </main>
    </>
  );
}
