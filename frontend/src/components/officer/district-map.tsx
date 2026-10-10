"use client";

/**
 * Where the booked fields are: every village with a booking at its real position (OpenStreetMap),
 * sized by its active fields and marked by its worst state (a cross for burn risk, a ring for
 * tight, a dot when all are on track), machine centres as squares, on the real district outline.
 * The view fits the villages the centres serve (with the outline clipped around them), so one
 * centre fills the map as well as twenty-five do. Hover or focus a village for its counts; the
 * same counts are in "Villages to watch" beside it, so nothing is hover-only.
 */
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { OfficerOverview } from "@/shared";
import { STATUS_COLOUR, STATUS_ORDER, villageStatus, type VillageStatus } from "./status";

const WIDTH = 560;
const HEIGHT = 420;
const PADDING = 36;

function Mark({ status, x, y, radius }: { status: VillageStatus; x: number; y: number; radius: number }) {
  const colour = STATUS_COLOUR[status];
  if (status === "atRisk") {
    const arm = radius * 0.85;
    return (
      <g strokeWidth={2.6} strokeLinecap="round" style={{ stroke: colour }}>
        <circle cx={x} cy={y} r={radius + 2} className="fill-surface" stroke="none" />
        <line x1={x - arm} y1={y - arm} x2={x + arm} y2={y + arm} />
        <line x1={x - arm} y1={y + arm} x2={x + arm} y2={y - arm} />
      </g>
    );
  }
  if (status === "tight") return <circle cx={x} cy={y} r={radius} className="fill-surface" strokeWidth={2.6} style={{ stroke: colour }} />;
  return <circle cx={x} cy={y} r={radius} className="stroke-surface" strokeWidth={2} style={{ fill: colour }} />;
}

export function MapLegend() {
  const t = useTranslations("officer");
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      {STATUS_ORDER.map((status) => (
        <li key={status} className="flex items-center gap-2">
          <svg aria-hidden width={16} height={16} viewBox="-8 -8 16 16">
            <Mark status={status} x={0} y={0} radius={5} />
          </svg>
          {t(`status_${status}`)}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <svg aria-hidden width={16} height={16} viewBox="-8 -8 16 16">
          <rect x={-4.5} y={-4.5} width={9} height={9} rx={2} className="fill-ink" />
        </svg>
        {t("legendCentre")}
      </li>
    </ul>
  );
}

export function DistrictMap({ overview }: { overview: OfficerOverview }) {
  const t = useTranslations("officer");
  const [focused, setFocused] = useState<string | null>(null);

  const layout = useMemo(() => {
    const points = [...overview.villages.map((village) => [village.lon, village.lat]), ...overview.centres.map((centre) => [centre.lon, centre.lat])];
    if (points.length === 0) return null;
    const meanLat = points.reduce((sum, [, lat]) => sum + lat!, 0) / points.length;
    // Longitude shrinks with latitude; scale it so distances look right.
    const squeeze = Math.cos((meanLat * Math.PI) / 180);
    const xs = points.map(([lon]) => lon! * squeeze);
    const ys = points.map(([, lat]) => lat!);
    // At least ~10 km across, so a single village does not fill the map.
    const minSpan = 0.09;
    let [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (maxX - minX < minSpan) [minX, maxX] = [(minX + maxX) / 2 - minSpan / 2, (minX + maxX) / 2 + minSpan / 2];
    if (maxY - minY < minSpan) [minY, maxY] = [(minY + maxY) / 2 - minSpan / 2, (minY + maxY) / 2 + minSpan / 2];
    const scale = Math.min((WIDTH - 2 * PADDING) / (maxX - minX), (HEIGHT - 2 * PADDING) / (maxY - minY));
    const offsetX = (WIDTH - (maxX - minX) * scale) / 2;
    const offsetY = (HEIGHT - (maxY - minY) * scale) / 2;
    const project = (lon: number, lat: number) => ({ x: offsetX + (lon * squeeze - minX) * scale, y: offsetY + (maxY - lat) * scale });
    const outlines = overview.districts.map((district) => ({
      name: district.name,
      path: district.rings
        .map((ring) => ring.map(([lon, lat], index) => `${index === 0 ? "M" : "L"}${project(lon, lat).x.toFixed(1)},${project(lon, lat).y.toFixed(1)}`).join("") + "Z")
        .join(""),
    }));
    const maxFields = Math.max(1, ...overview.villages.map((village) => village.fieldsActive));
    const villages = overview.villages
      .filter((village) => village.fieldsActive > 0)
      .map((village) => ({ village, status: villageStatus(village), radius: 4 + 6 * Math.sqrt(village.fieldsActive / maxFields), ...project(village.lon, village.lat) }))
      // Worst on top: at-risk villages are drawn last.
      .sort((left, right) => STATUS_ORDER.indexOf(right.status) - STATUS_ORDER.indexOf(left.status));
    const centres = overview.centres.map((centre) => ({ centre, ...project(centre.lon, centre.lat) }));
    return { outlines, villages, centres };
  }, [overview]);

  const centreNames = new Map(overview.centres.map((centre) => [centre.id, centre.name]));
  const focusedVillage = overview.villages.find((village) => `${village.centreId}/${village.id}` === focused) ?? null;
  const describe = (village: OfficerOverview["villages"][number]) =>
    t("villageReadout", { name: village.name, fields: village.fieldsActive, acres: village.acresActive, atRisk: village.burnRisk, tight: village.tight, sown: village.fieldsSown });

  if (!layout) return <p className="text-ink-muted">{t("mapEmpty")}</p>;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={t("mapLabel", { villages: layout.villages.length, centres: layout.centres.length })} className="h-auto w-full">
        <defs>
          <clipPath id="officer-map-clip">
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={12} />
          </clipPath>
        </defs>
        <g clipPath="url(#officer-map-clip)">
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="fill-line/40" />
          {layout.outlines.map((outline) => (
            <path key={outline.name} d={outline.path} className="fill-paper stroke-ink-muted" strokeWidth={1.2} strokeLinejoin="round" />
          ))}
        </g>
        {layout.villages.map(({ village, status, radius, x, y }) => {
          const key = `${village.centreId}/${village.id}`;
          return (
            <g
              key={key}
              tabIndex={0}
              role="img"
              aria-label={describe(village)}
              onPointerEnter={() => setFocused(key)}
              onPointerLeave={() => setFocused((current) => (current === key ? null : current))}
              onFocus={() => setFocused(key)}
              onBlur={() => setFocused((current) => (current === key ? null : current))}
              className="cursor-default outline-none"
            >
              {focused === key ? <circle cx={x} cy={y} r={radius + 6} fill="none" className="stroke-sky" strokeWidth={2} /> : null}
              <Mark status={status} x={x} y={y} radius={focused === key ? radius + 1.5 : radius} />
              {/* A hit area well beyond the mark. */}
              <circle cx={x} cy={y} r={Math.max(12, radius + 6)} fill="transparent" strokeWidth={2} stroke="transparent" />
            </g>
          );
        })}
        {layout.centres.map(({ centre, x, y }) => (
          <g key={centre.id} aria-hidden>
            <rect x={x - 5} y={y - 5} width={10} height={10} rx={2} className="fill-ink stroke-surface" strokeWidth={2} />
            <text x={x + 9} y={y + 4} className="fill-ink text-[12px] font-medium" paintOrder="stroke" stroke="var(--color-paper)" strokeWidth={4} strokeLinejoin="round">
              {centre.name}
            </text>
          </g>
        ))}
      </svg>
      <p aria-live="polite" className="mt-3 min-h-11 text-sm text-ink-muted">
        {focusedVillage ? (
          <>
            <span className="font-medium text-ink">{focusedVillage.name}</span> · {centreNames.get(focusedVillage.centreId)} ·{" "}
            {t("villageCounts", { fields: focusedVillage.fieldsActive, atRisk: focusedVillage.burnRisk, tight: focusedVillage.tight })}
          </>
        ) : (
          t("mapHint")
        )}
      </p>
    </div>
  );
}
