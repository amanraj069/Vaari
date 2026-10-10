/**
 * The person using the app, as both the server and the browser describe them. Staff have a role
 * (or none yet, before /welcome); a farmer is their phone session and has no role.
 */
import type { FarmerMe, Me } from "@/shared";
import type { DashboardRole } from "./dashboard-routes";

export type Viewer = { kind: "staff"; me: Me } | { kind: "farmer"; farmer: FarmerMe };

/** The dashboard this person gets; null while a new staff member has not finished /welcome. */
export function dashboardRole(viewer: Viewer): DashboardRole | null {
  if (viewer.kind === "farmer") return "farmer";
  if (viewer.me.needsOnboarding || !viewer.me.role) return null;
  return viewer.me.role;
}

export function viewerName(viewer: Viewer): string | null {
  return viewer.kind === "farmer" ? viewer.farmer.name : viewer.me.name;
}

/**
 * Up to two initials for the avatar, from words that start with a letter: "District officer (demo)"
 * gives "DO", never "D(". Null when there is no name to take them from (the avatar shows an icon).
 */
export function initials(name: string | null): string | null {
  if (!name) return null;
  const words = name.trim().split(/\s+/).filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return null;
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : [words[0]!];
  return letters.map((word) => Array.from(word)[0]!).join("").toUpperCase();
}
