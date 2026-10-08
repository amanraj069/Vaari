/** Great-circle distance; used for village assignment and the demo CHC's catchment. */
const EARTH_RADIUS_KM = 6371;

export function haversineKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(latB - latA);
  const deltaLon = toRadians(lonB - lonA);
  const chord = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(chord));
}
