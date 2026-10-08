// GENERATED from backend/src/shared by `npm run contract:sync` in backend/. Do not edit here.
/**
 * Machine speed learned from work logs; the same rule as backend/engine/vaari_engine/rates.py.
 * Sources disagree (CEEW interviews: about 5.3 acres in an 8-hour day; a district office: 10-12),
 * so each machine starts from a prior spread across that range and narrows with real logs.
 * Promises use the 20th percentile; tomorrow's route uses the median.
 */
export const PRIOR_LOW_ACRES_PER_DAY = 5.3;
export const PRIOR_HIGH_ACRES_PER_DAY = 12.0;
export const PRIOR_REFERENCE_HOURS = 8.0;
export const PRIOR_PSEUDO_OBSERVATIONS = 5; // assumed weight of the prior against real logs

function quantile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 1) return sortedValues[0]!;
  const position = probability * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const fraction = position - lowerIndex;
  return sortedValues[lowerIndex]! + (sortedValues[upperIndex]! - sortedValues[lowerIndex]!) * fraction;
}

export type LearnedRate = { promiseAcresPerHour: number; planAcresPerHour: number; observations: number };

export function learnRate(workLogs: { acres: number; hours: number }[]): LearnedRate {
  const priorStep = (PRIOR_HIGH_ACRES_PER_DAY - PRIOR_LOW_ACRES_PER_DAY) / (PRIOR_PSEUDO_OBSERVATIONS - 1);
  const samples: number[] = [];
  for (let index = 0; index < PRIOR_PSEUDO_OBSERVATIONS; index += 1) {
    samples.push((PRIOR_LOW_ACRES_PER_DAY + index * priorStep) / PRIOR_REFERENCE_HOURS);
  }
  const usableLogs = workLogs.filter((log) => log.hours > 0 && log.acres > 0);
  for (const log of usableLogs) samples.push(log.acres / log.hours);
  samples.sort((left, right) => left - right);
  // No rounding: Python rounds half to even and JavaScript half up, so rounding here would make
  // the two implementations disagree in the fourth decimal (0.74625 -> 0.7462 vs 0.7463).
  return {
    promiseAcresPerHour: quantile(samples, 0.2),
    planAcresPerHour: quantile(samples, 0.5),
    observations: usableLogs.length,
  };
}
