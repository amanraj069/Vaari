/**
 * /signin/helper, /signin/operator, /signin/officer: sign-in for village helpers, operators and
 * officers: the form (StaffAuthCard) in the right-hand card; the photo and the card come from
 * ../layout.tsx, shared with /signin. The picked role is remembered for /welcome, where a new person sets up; it grants
 * nothing (roles come from Cognito groups). Farmers sign in on /farmer/signin.
 */
import { notFound, redirect } from "next/navigation";
import { meSchema } from "@/shared";
import { StaffAuthCard } from "@/components/staff-auth-card";
import {
  emailSignInAvailable,
  isStaffPick,
  passwordPolicy,
} from "@/lib/cognito";
import { serverConfig } from "@/lib/server-config";
import { apiFetch } from "@/lib/session";

export default async function StaffSignInPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (!isStaffPick(role)) notFound();
  const meResponse = await apiFetch("/me").catch(() => null);
  if (meResponse?.ok && meSchema.safeParse(await meResponse.json()).success)
    redirect("/api/auth/resume");

  return (
    <div className="flex h-full flex-col justify-center rounded-card border border-line bg-surface p-5 sm:px-8 sm:py-7">
      <StaffAuthCard
        initialRole={role}
        googleOn={serverConfig.authMode === "cognito"}
        emailOn={emailSignInAvailable()}
        passwordRules={passwordPolicy()}
      />
    </div>
  );
}
