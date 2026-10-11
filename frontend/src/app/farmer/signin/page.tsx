/**
 * /farmer/signin, in AuthSplitLayout: on the left the other way in (do it all on WhatsApp, an
 * example chat); on the right the sign-in itself (mobile number and consent, the code, then the
 * name if the number is new). On phones the form comes first, then the WhatsApp card (the phone
 * picture hidden) with its "Open WhatsApp" button. Staff sign in on /signin. `next` may only send the farmer to their pages
 * (their dashboard). `link` says why they are here: a used or expired WhatsApp link, or a sign-in that ended.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthSplitLayout } from "@/components/auth-split-layout";
import { BackButton } from "@/components/back-button";
import { FarmerLinkNotice, parseLinkProblem } from "@/components/farmer-link-notice";
import { FarmerSigninForm } from "@/components/farmer-signin-form";
import { PAGE_FRAME, PageHeader } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { WhatsAppStart } from "@/components/whatsapp-start";
import { serverConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

const NEXT_PAGES = new Set(["/dashboard", "/dashboard/book"]);

export default async function FarmerSignInPage({ searchParams }: { searchParams: Promise<{ next?: string; link?: string }> }) {
  const t = await getTranslations("farmerSignin");
  const { next, link } = await searchParams;
  const linkProblem = parseLinkProblem(link);
  const whatsappNumber = serverConfig.whatsappBusinessNumber || null;
  return (
    <>
      <TopBar />
      <main className={`pb-16 pt-8 sm:pt-10 ${PAGE_FRAME}`}>
        {/* Without WHATSAPP_BUSINESS_NUMBER (on Amplify: the build spec's .env.production) there is no
            chat to open: the form stands alone instead of beside an empty half. */}
        <AuthSplitLayout visual={whatsappNumber ? <WhatsAppStart number={whatsappNumber} fill /> : null} visualBelow compact>
          <div className="mx-auto w-full max-w-md">
            <PageHeader back={<BackButton fallback="/" />} title={t("title")} description={t("subtitle")} shortDescription={t("subtitleShort")} />
            {linkProblem ? (
              <div className="mt-5">
                <FarmerLinkNotice problem={linkProblem} />
              </div>
            ) : null}
            <div className="mt-5">
              <FarmerSigninForm next={next && NEXT_PAGES.has(next) ? next : "/dashboard"} />
            </div>
            <p className="mt-4 border-t border-line pt-3 text-center">
              <Link href="/signin" className="inline-flex min-h-11 items-center text-sm font-medium text-wheat-deep underline decoration-wheat-deep/40 underline-offset-4 hover:decoration-wheat-deep">
                {t("staffLink")}
              </Link>
            </p>
          </div>
        </AuthSplitLayout>
      </main>
    </>
  );
}
