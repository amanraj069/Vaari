/**
 * The officer's three states for a village, worst first, and how each is drawn. The colours are
 * the proof map's season tokens (validated together for colour-blind separation in both themes);
 * every mark also has a shape and every count a word, so colour is never the only signal.
 */
import type { OfficerCentre, OfficerVillage } from "@/shared";

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

/**
 * A centre's outlook over the plan's days, worst first (a forecast, labelled so on the page):
 * fields will pass their last waiting day; one breakdown would make that happen; on time. The
 * map, the table and the decision card all read it from here, so they never disagree.
 */
export type CentreState = "late" | "fragile" | "onTime";

// Below half an acre the forecast cannot tell late from on time (the API uses the same margin).
const LATE_MARGIN_ACRES = 0.5;

export function centreState(centre: OfficerCentre): CentreState {
  if (centre.outlook.lateAcres > LATE_MARGIN_ACRES) return "late";
  if ((centre.outlook.lateIfOneDownAcres ?? 0) > LATE_MARGIN_ACRES) return "fragile";
  return "onTime";
}

export const CENTRE_STATE_ORDER: CentreState[] = ["late", "fragile", "onTime"];

/** Worst outlook first, then the most acres at stake, then fields at burn risk now. */
export function byOutlook(left: OfficerCentre, right: OfficerCentre): number {
  return (
    CENTRE_STATE_ORDER.indexOf(centreState(left)) - CENTRE_STATE_ORDER.indexOf(centreState(right)) ||
    right.outlook.lateAcres - left.outlook.lateAcres ||
    (right.outlook.lateIfOneDownAcres ?? 0) - (left.outlook.lateIfOneDownAcres ?? 0) ||
    right.burnRisk - left.burnRisk ||
    left.name.localeCompare(right.name)
  );
}
