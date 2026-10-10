"use client";

/** The dashboard when the API cannot say who is signed in: a calm message and a retry, never a sign-in page. */
import { useTranslations } from "next-intl";
import { PageMain } from "../page-shell";
import { TopBar } from "../top-bar";
import { Button, StateMessage } from "../ui";

export function DashboardUnavailable() {
  const tc = useTranslations("common");
  return (
    <>
      <TopBar />
      <PageMain>
        <div className="mx-auto mt-10 max-w-xl">
          <StateMessage tone="error" title={tc("errorTitle")} body={tc("errorBody")} action={<Button onClick={() => window.location.reload()}>{tc("retry")}</Button>} />
        </div>
      </PageMain>
    </>
  );
}
