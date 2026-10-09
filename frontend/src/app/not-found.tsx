/**
 * Any address that does not exist: a calm page with a way home, in the visitor's language, instead
 * of the framework's bare "404".
 */
import { MapPinOff } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { StateMessage } from "@/components/ui";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <>
      <TopBar />
      <PageMain>
        <div className="mx-auto mt-10 max-w-xl">
          <StateMessage
            icon={MapPinOff}
            title={t("notFoundTitle")}
            body={t("notFoundBody")}
            action={
              <Link href="/" className="inline-flex min-h-11 items-center rounded-control bg-ink px-5 font-medium text-paper">
                {t("goHome")}
              </Link>
            }
          />
        </div>
      </PageMain>
    </>
  );
}
