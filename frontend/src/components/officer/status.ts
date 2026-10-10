/**
 * The officer's three states for a village, worst first, and how each is drawn. The colours are
 * the proof map's season tokens (validated together for colour-blind separation in both themes);
 * every mark also has a shape and every count a word, so colour is never the only signal.
 */
import type { OfficerVillage } from "@/shared";

export type VillageStatus = "atRisk" | "tight" | "onTrack";

export const STATUS_COLOUR: Record<VillageStatus, string> = {
  atRisk: "var(--color-season-burned)",
  tight: "var(--color-season-late)",
  onTrack: "var(--color-season-ontime)",
};

export const STATUS_ORDER: VillageStatus[] = ["atRisk", "tight", "onTrack"];

export function villageStatus(village: OfficerVillage): VillageStatus {
  if (village.burnRisk > 0) return "atRisk";
  if (village.tight > 0) return "tight";
  return "onTrack";
}

/** Fields per status in one village: at risk, tight, and the rest of its active fields. */
export function villageSplit(village: OfficerVillage): Record<VillageStatus, number> {
  return { atRisk: village.burnRisk, tight: village.tight, onTrack: Math.max(0, village.fieldsActive - village.burnRisk - village.tight) };
}
