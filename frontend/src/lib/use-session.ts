"use client";

/**
 * Who is signed in (staff or a farmer's phone session), for the top bar on public pages. One query
 * key, so a sign-in or onboarding can refresh it everywhere (`useRefreshSession()`).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { farmerMeSchema, meSchema } from "@/shared";
import type { Viewer } from "./viewer-kind";

export const SESSION_QUERY_KEY = ["session"] as const;

const viewerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("staff"), me: meSchema }),
  z.object({ kind: z.literal("farmer"), farmer: farmerMeSchema }),
]);

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<Viewer | null> => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      // 503 means "unknown" (API unreachable), not "signed out": fail the query so callers can tell.
      if (!response.ok) throw new Error(`session check failed (${response.status})`);
      const body = (await response.json()) as { signedIn: boolean; viewer?: unknown };
      const parsed = viewerSchema.safeParse(body.viewer);
      return body.signedIn && parsed.success ? parsed.data : null;
    },
    staleTime: 30_000,
    // Keep the last known identity through a brief API outage, and keep checking until it is back.
    retry: 2,
    refetchInterval: (query) => (query.state.status === "error" ? 5_000 : false),
  });
}

export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}
