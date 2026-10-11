"use client";

/**
 * Moving between dashboard pages: every page first checks who is looking on the server, so without
 * this the old page stayed on screen (under the new page's marker) until that check answered. This
 * is the page-sized Suspense fallback Next shows the moment a link is clicked: the heading, a row
 * of numbers and a panel in the dashboard's shape, so the click answers at once and nothing jumps.
 */
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui";

export default function DashboardLoading() {
  const tc = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" data-testid="dashboard-loading">
      <span className="sr-only" role="status">
        {tc("loading")}
      </span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
