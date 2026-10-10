/**
 * Sign-in: the right-hand side (the photo comes from layout.tsx, shared with /signin/<role>): the
 * title, then farmers and staff in two cards and the demo accounts pinned to the bottom
 * (SignInChooser). A signed-in visitor goes straight to their page; a failed or role-less sign-in
 * gets a plain explanation instead of a silent bounce.
 */
import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { meSchema } from "@/shared";
import { PageHeader } from "@/components/page-shell";
import { SignInChooser } from "@/components/signin-chooser";
import { serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

async function currentUser() {
  const response = await apiFetch("/me").catch(() => null);
  if (!response?.ok) return null;
  const parsed = meSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; pick?: string }>;
}) {
  const t = await getTranslations("signin");
  const { error, pick } = await searchParams;
  const me = await currentUser();
  if (me) redirect("/api/auth/resume");
  const cognitoOn = serverConfig.authMode === "cognito";
  const people = [
    {
      role: "farmer" as const,
      name: t("farmerCard"),
      detail: t("farmerCardRole"),
    },
    {
      role: "facilitator" as const,
      name: t("facilitatorCard"),
      detail: t("facilitatorCardRole"),
    },
    {
      role: "operator" as const,
      name: t("operatorCard"),
      detail: t("operatorCardRole"),
    },
    {
      role: "officer" as const,
      name: t("officerCard"),
      detail: t("officerCardRole"),
    },
  ];
  return (
    <>
      <PageHeader title={t("title")} />

      {error ? (
        <div
          role="alert"
          className="mt-6 flex gap-2 rounded-card border border-ember/40 bg-ember-soft/50 p-5 text-ember-deep"
        >
          <AlertTriangle
            aria-hidden
            className="mt-0.5 size-5 shrink-0"
            strokeWidth={1.75}
          />
          <p>
            {error === "no_role"
              ? t("errorNoRole")
              : error === "unavailable"
                ? t("errorUnavailable")
                : t("errorGeneric")}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-1 flex-col">
        <SignInChooser
          people={people}
          demoMode={serverConfig.demoMode}
          googleOn={cognitoOn}
          initialPick={
            pick === "helper" || pick === "operator" || pick === "officer"
              ? pick
              : null
          }
        />
      </div>
    </>
  );
}
