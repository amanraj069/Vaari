"use client";

/**
 * Who is signed in, for the top bar on every page. One query key, so a sign-in or onboarding can
 * refresh it everywhere (call `useRefreshSession()` after anything that changes the session).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { meSchema, type Me } from "@/shared";

export const SESSION_QUERY_KEY = ["session"] as const;

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<Me | null> => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const body = (await response.json()) as { signedIn: boolean; me?: unknown };
      const parsed = meSchema.safeParse(body.me);
      return body.signedIn && parsed.success ? parsed.data : null;
    },
    staleTime: 30_000,
  });
}

export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}
