/**
 * /privacy: public, no sign-in (middleware does not match it), and meant to be found: indexable
 * by search engines and server-rendered, so crawlers read the whole notice. Unlike the private
 * pages (src/lib/private-pages.ts) it carries no noindex. The contact address comes from
 * CONTACT_EMAIL (server-only), so WhatsApp replies and this page can point at one inbox.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageMain } from "@/components/page-shell";
import { PrivacyNotice } from "@/components/privacy-notice";
import { TopBar } from "@/components/top-bar";
import { serverConfig } from "@/lib/server-config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: true, follow: true },
    // Absolute: the root layout sets no metadataBase, and a relative canonical would point at localhost.
    alternates: { canonical: `${serverConfig.publicBaseUrl.replace(/\/$/, "")}/privacy` },
  };
}

export default function PrivacyPage() {
  return (
    <>
      <TopBar />
      <PageMain>
        <PrivacyNotice contactEmail={serverConfig.contactEmail} />
      </PageMain>
    </>
  );
}
