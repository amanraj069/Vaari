/**
 * The officer's two pages read one query (GET /officer/overview), so moving between the map and
 * the centres keeps the same numbers and needs no second request. Polled every 30 seconds.
 */
import { useQuery } from "@tanstack/react-query";
import { officerOverviewSchema, type OfficerOverview } from "@/shared";
import { api } from "@/lib/api";

export function useOfficerOverview() {
  return useQuery({ queryKey: ["officer-overview"], queryFn: () => api("officer/overview", officerOverviewSchema), refetchInterval: 30_000 });
}

/** Late acres left after the suggested loans (each loan says its borrower's before and after). */
export function lateAfterLending(overview: OfficerOverview): number {
  return Math.max(0, overview.outlook.lateAcres - overview.outlook.moves.reduce((sum, move) => sum + (move.lateBeforeAcres - move.lateAfterAcres), 0));
}
