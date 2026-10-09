"use client";

/**
 * Anything that breaks while a page renders: a calm message and a way to try again, never the
 * error's own text (that goes to the console for the team, not to a farmer).
 */
import { CloudOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { PageMain } from "@/components/page-shell";
import { Button, StateMessage } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageMain>
      <div className="mx-auto mt-10 max-w-xl">
        <StateMessage
          tone="error"
          icon={CloudOff}
          title={t("crashTitle")}
          body={t("crashBody")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => reset()}>{t("retry")}</Button>
              <Link href="/" className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-5 font-medium">
                {t("goHome")}
              </Link>
            </div>
          }
        />
      </div>
    </PageMain>
  );
}
