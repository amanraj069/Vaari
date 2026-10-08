/**
 * Reads NASA FIRMS VIIRS active-fire CSVs (archive download format). Why it exists: the demo
 * season's harvest timing must come from real fire detections, not invented dates. Parsing is
 * strict about the columns we use and never touches the file on disk.
 */
export type FireDetection = {
  lat: number;
  lon: number;
  date: string; // acq_date, ISO YYYY-MM-DD (UTC)
  time: string; // acq_time, HHMM UTC
  satellite: string;
  confidence: "l" | "n" | "h";
  dayNight: "D" | "N";
  type: string; // FIRMS "type": 0 = presumed vegetation fire
};

const REQUIRED_COLUMNS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "daynight", "type"] as const;

export class FirmsFormatError extends Error {}

export function parseFirmsCsv(text: string, sourceName: string): FireDetection[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = (lines.shift() ?? "").split(",").map((column) => column.trim());
  const indexOf = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)])) as Record<(typeof REQUIRED_COLUMNS)[number], number>;
  const missing = REQUIRED_COLUMNS.filter((column) => indexOf[column] < 0);
  if (missing.length > 0) throw new FirmsFormatError(`${sourceName}: missing column(s) ${missing.join(", ")}`);

  return lines.map((line, rowIndex) => {
    const cells = line.split(",");
    const lat = Number(cells[indexOf.latitude]);
    const lon = Number(cells[indexOf.longitude]);
    const date = cells[indexOf.acq_date] ?? "";
    const confidence = cells[indexOf.confidence] as FireDetection["confidence"];
    const dayNight = cells[indexOf.daynight] as FireDetection["dayNight"];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["l", "n", "h"].includes(confidence) || !["D", "N"].includes(dayNight)) {
      throw new FirmsFormatError(`${sourceName}: row ${rowIndex + 2} is not a valid VIIRS detection`);
    }
    return {
      lat,
      lon,
      date,
      time: cells[indexOf.acq_time] ?? "",
      satellite: cells[indexOf.satellite] ?? "",
      confidence,
      dayNight,
      type: cells[indexOf.type] ?? "",
    };
  });
}
