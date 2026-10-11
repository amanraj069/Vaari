"use client";

/**
 * The officer's map, the first thing on the page: the real district outline (OpenStreetMap) with
 * every machine centre as a square sized by its machines and filled by its outlook (fields late,
 * one breakdown away, on time; the legend gives each a word), and each suggested loan as a curved
 * dashed arrow from the lending centre, numbered like the list beside the map. By default it shows
 * all booked villages (cross for burn risk, ring for tight, dot for on track); the "critical only"
 * switch narrows it to fields at burn risk. A centre is a button: choosing it rings it, names it and
 * shows its villages, and the panel beside the map gives its facts. Hover or focus a village for its
 * counts. Only centres with a decision (or the chosen one) are named, so 25 labels never pile up.
 */
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { OfficerOverview } from "@/shared";
import { centreState, STATUS_COLOUR, STATUS_ORDER, villageStatus, type CentreState, type VillageStatus } from "./status";

export type MapLayer = "all" | "critical" | "attention";

export const CENTRE_FILL: Record<CentreState, string> = {
  late: "var(--color-season-burned)",
  fragile: "var(--color-season-late)",
  onTime: "var(--color-ink)",
};

const WIDTH = 600;
const PADDING = 14;
// The map box takes the district's own shape (it is taller than wide), within these heights.
const MIN_HEIGHT = 360;
const MAX_HEIGHT = 820;

function Mark({ status, x, y, radius, stroke = 1 }: { status: VillageStatus; x: number; y: number; radius: number; stroke?: number }) {
  const colour = STATUS_COLOUR[status];
  if (status === "atRisk") {
    const arm = radius * 0.85;
    return (
      <g strokeWidth={2.6 * stroke} strokeLinecap="round" style={{ stroke: colour }}>
        <circle cx={x} cy={y} r={radius + 2} className="fill-surface" stroke="none" />
        <line x1={x - arm} y1={y - arm} x2={x + arm} y2={y + arm} />
        <line x1={x - arm} y1={y + arm} x2={x + arm} y2={y - arm} />
      </g>
    );
  }
  if (status === "tight") return <circle cx={x} cy={y} r={radius} className="fill-surface" strokeWidth={2.2 * stroke} style={{ stroke: colour }} />;
  return <circle cx={x} cy={y} r={radius} className="stroke-surface" strokeWidth={1.5 * stroke} style={{ fill: colour }} />;
}

export function MapLegend({ layer, hasLoans = false }: { layer: MapLayer; hasLoans?: boolean }) {
  const t = useTranslations("officer");
  const villageStates = layer === "all" ? STATUS_ORDER : (["atRisk"] as VillageStatus[]);
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] leading-snug sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1.5 sm:text-sm lg:flex-col lg:items-start lg:gap-y-2.5 lg:text-[13px]">
      {(["late", "fragile", "onTime"] as const).map((state) => (
        <li key={state} className="flex items-center gap-2">
          <svg aria-hidden className="shrink-0" width={14} height={14} viewBox="-7 -7 14 14">
            <rect x={-5} y={-5} width={10} height={10} rx={2} style={{ fill: CENTRE_FILL[state] }} />
          </svg>
          {t(`legendCentre_${state}`)}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <svg aria-hidden width={24} height={14} viewBox="0 -7 24 14">
          <line x1={1} y1={0} x2={17} y2={0} strokeWidth={2} strokeDasharray="4 3" className="stroke-wheat-deep" />
          <path d="M16,-4 L22,0 L16,4 Z" className="fill-wheat-deep" />
        </svg>
        {t("legendMove")}
      </li>
      {hasLoans ? (
        <li className="flex items-center gap-2">
          <svg aria-hidden className="shrink-0" width={24} height={14} viewBox="0 -7 24 14">
            <line x1={1} y1={0} x2={17} y2={0} strokeWidth={2.4} className="stroke-sky" />
            <path d="M16,-4 L22,0 L16,4 Z" className="fill-sky" />
          </svg>
          {t("legendLoan")}
        </li>
      ) : null}
      {villageStates.map((status) => (
        <li key={status} className="flex items-center gap-2">
          <svg aria-hidden width={14} height={14} viewBox="-7 -7 14 14">
            <Mark status={status} x={0} y={0} radius={4.5} />
          </svg>
          {t(`legendVillage_${status}`)}
        </li>
      ))}
    </ul>
  );
}

export function DistrictMap({
  overview,
  layer,
  selectedId,
  onSelect,
  highlightedMove,
}: {
  overview: OfficerOverview;
  layer: MapLayer;
  selectedId: string | null;
  onSelect: (centreId: string | null) => void;
  highlightedMove: number | null;
}) {
  const t = useTranslations("officer");
  const [focusedVillage, setFocusedVillage] = useState<string | null>(null);
  // Map units per screen pixel: labels, badges and tap areas are sized in real pixels, so a
  // name is 13px and a centre's tap area 44px whether the map is 360px or 900px wide.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [unitsPerPixel, setUnitsPerPixel] = useState(1);
  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const viewHeight = element.viewBox.baseVal?.height || WIDTH;
      if (box.width > 0 && box.height > 0) setUnitsPerPixel(Math.min(4, Math.max(0.5, 1 / Math.min(box.width / WIDTH, box.height / viewHeight))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const px = (pixels: number) => pixels * unitsPerPixel;

  // From tablets up the whole map card fits the window: the map gets the height between its own top
  // (with the page scrolled to the top) and the window's bottom, less what sits under it in the
  // card (the hint and the legend). Never below 320px. Phones keep the full-width map.
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const fit = () => {
      if (window.innerWidth < 640) return setFitHeight(null);
      const card = element.closest("section") ?? element.parentElement;
      const box = element.getBoundingClientRect();
      const below = card ? card.getBoundingClientRect().bottom - box.bottom : 0;
      const top = box.top + window.scrollY;
      setFitHeight(Math.max(320, Math.floor(window.innerHeight - top - below - 24)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const layout = useMemo(() => {
    const outlinePoints = overview.districts.flatMap((district) => district.rings.flat());
    // Fit the district when there are many centres; a single centre's corner otherwise.
    const fitPoints =
      overview.centres.length > 3 && outlinePoints.length > 0
        ? outlinePoints
        : [...overview.villages.map((village) => [village.lon, village.lat] as [number, number]), ...overview.centres.map((centre) => [centre.lon, centre.lat] as [number, number])];
    if (fitPoints.length === 0) return null;
    const meanLat = fitPoints.reduce((sum, [, lat]) => sum + lat, 0) / fitPoints.length;
    // Longitude shrinks with latitude; scale it so distances look right.
    const squeeze = Math.cos((meanLat * Math.PI) / 180);
    const xs = fitPoints.map(([lon]) => lon * squeeze);
    const ys = fitPoints.map(([, lat]) => lat);
    const minSpan = 0.09;
    let [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (maxX - minX < minSpan) [minX, maxX] = [(minX + maxX) / 2 - minSpan / 2, (minX + maxX) / 2 + minSpan / 2];
    if (maxY - minY < minSpan) [minY, maxY] = [(minY + maxY) / 2 - minSpan / 2, (minY + maxY) / 2 + minSpan / 2];
    const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, 2 * PADDING + ((maxY - minY) / (maxX - minX)) * (WIDTH - 2 * PADDING))));
    const scale = Math.min((WIDTH - 2 * PADDING) / (maxX - minX), (height - 2 * PADDING) / (maxY - minY));
    const offsetX = (WIDTH - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;
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
      .map((village) => ({ village, status: villageStatus(village), radius: 2.5 + 3.5 * Math.sqrt(village.fieldsActive / maxFields), ...project(village.lon, village.lat) }))
      // Worst on top: at-risk villages are drawn last.
      .sort((left, right) => STATUS_ORDER.indexOf(right.status) - STATUS_ORDER.indexOf(left.status));
    const maxMachines = Math.max(1, ...overview.centres.map((centre) => centre.machinesTotal));
    const centres = overview.centres.map((centre) => ({ centre, state: centreState(centre), size: 10 + 8 * Math.sqrt(centre.machinesTotal / maxMachines), ...project(centre.lon, centre.lat) }));
    const centreById = new Map(centres.map((item) => [item.centre.id, item]));
    const moves = overview.outlook.moves.flatMap((move, index) => {
      const from = centreById.get(move.fromCentreId);
      const to = centreById.get(move.toCentreId);
      return from && to ? [{ index, move, from, to }] : [];
    });
    // Loans already arranged: solid arrows, no number (they are done, not suggestions).
    const loans = overview.outlook.loans.flatMap((loan) => {
      const from = centreById.get(loan.fromChcId);
      const to = centreById.get(loan.toChcId);
      return from && to ? [{ loan, from, to }] : [];
    });
    return { outlines, villages, centres, moves, loans, height };
  }, [overview]);

  if (!layout) return <p className="text-ink-muted">{t("mapEmpty")}</p>;

  const inMoves = new Set(overview.outlook.moves.flatMap((move) => [move.fromCentreId, move.toCentreId]));
  const centreNames = new Map(overview.centres.map((centre) => [centre.id, centre.name]));
  const shownVillages = layout.villages.filter(({ village, status }) => layer === "all" || status === "atRisk" || village.centreId === selectedId);
  const focused = layout.villages.find(({ village }) => `${village.centreId}/${village.id}` === focusedVillage)?.village ?? null;
  const highlightedPair = highlightedMove !== null ? overview.outlook.moves[highlightedMove] : null;
  const isEmphasised = (centreId: string) => (highlightedPair ? highlightedPair.fromCentreId === centreId || highlightedPair.toCentreId === centreId : selectedId === null || selectedId === centreId);
  // Names, most important first; each goes right of its square, else left, else is left off, so
  // labels never sit on one another (or on a square) at any width.
  const labelPlacement = new Map<string, "right" | "left">();
  {
    const priority = (centreId: string, state: CentreState) => (centreId === selectedId ? 0 : state === "late" ? 1 : inMoves.has(centreId) ? 2 : state === "fragile" ? 3 : 4);
    const placed: { left: number; right: number; top: number; bottom: number }[] = layout.centres.map(({ x, y, size }) => ({ left: x - px(size) / 2, right: x + px(size) / 2, top: y - px(size) / 2, bottom: y + px(size) / 2 }));
    const candidates = layout.centres
      .filter(({ centre, state }) => overview.centres.length <= 3 || state !== "onTime" || inMoves.has(centre.id) || centre.id === selectedId)
      .sort((left, right) => priority(left.centre.id, left.state) - priority(right.centre.id, right.state));
    for (const { centre, x, y, size } of candidates) {
      const width = centre.name.replace(/ CHC$/, "").length * px(7.4);
      const half = px(size) / 2;
      const boxes = {
        right: { left: x + half + px(4), right: x + half + px(4) + width, top: y - px(8), bottom: y + px(8) },
        left: { left: x - half - px(4) - width, right: x - half - px(4), top: y - px(8), bottom: y + px(8) },
      };
      for (const side of ["right", "left"] as const) {
        const box = boxes[side];
        const clear = box.left >= 0 && box.right <= WIDTH && !placed.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
        if (clear) {
          labelPlacement.set(centre.id, side);
          placed.push(box);
          break;
        }
      }
    }
  }
  const choose = (centreId: string) => onSelect(selectedId === centreId ? null : centreId);
  const onCentreKey = (event: KeyboardEvent, centreId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(centreId);
    }
  };

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${layout.height}`} role="group" aria-label={t("mapLabel", { centres: layout.centres.length, villages: shownVillages.length })} className="mx-auto h-auto w-full" style={fitHeight ? { maxHeight: fitHeight } : undefined}>
        <defs>
          <marker id="officer-loan-head" viewBox="0 0 10 10" refX={7} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" className="fill-sky" />
          </marker>
          <marker id="officer-move-head" viewBox="0 0 10 10" refX={7} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" className="fill-wheat-deep" />
          </marker>
        </defs>
        {/* A click on the land clears the choice. */}
        <g onClick={() => onSelect(null)}>
          {layout.outlines.map((outline) => (
            <path key={outline.name} d={outline.path} className="fill-paper stroke-ink-muted" strokeWidth={px(1.2)} strokeLinejoin="round" />
          ))}
        </g>

        {shownVillages.map(({ village, status, radius, x, y }) => {
          const key = `${village.centreId}/${village.id}`;
          const faded = selectedId !== null && village.centreId !== selectedId && !highlightedPair;
          return (
            <g
              key={key}
              tabIndex={0}
              role="img"
              aria-label={t("villageReadout", { name: village.name, fields: village.fieldsActive, acres: village.acresActive, atRisk: village.burnRisk, tight: village.tight, sown: village.fieldsSown })}
              onPointerEnter={() => setFocusedVillage(key)}
              onPointerLeave={() => setFocusedVillage((current) => (current === key ? null : current))}
              onFocus={() => setFocusedVillage(key)}
              onBlur={() => setFocusedVillage((current) => (current === key ? null : current))}
              className="cursor-default outline-none transition-opacity duration-200"
              opacity={faded ? 0.3 : 1}
            >
              {focusedVillage === key ? <circle cx={x} cy={y} r={px(radius + 6)} fill="none" className="stroke-sky" strokeWidth={px(2)} /> : null}
              <Mark status={status} x={x} y={y} radius={px(status === "atRisk" ? Math.max(4.5, radius) : radius)} stroke={unitsPerPixel} />
              <circle cx={x} cy={y} r={px(Math.max(10, radius + 6))} fill="transparent" />
            </g>
          );
        })}

        {layout.loans.map(({ loan, from, to }) => {
          const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
          const [unitX, unitY] = [(to.x - from.x) / length, (to.y - from.y) / length];
          const start = { x: from.x + unitX * px(from.size / 2 + 4), y: from.y + unitY * px(from.size / 2 + 4) };
          const end = { x: to.x - unitX * px(to.size / 2 + 7), y: to.y - unitY * px(to.size / 2 + 7) };
          const bow = Math.min(px(28), length * 0.25);
          const control = { x: (start.x + end.x) / 2 - unitY * bow, y: (start.y + end.y) / 2 + unitX * bow };
          return (
            <path
              key={loan.id}
              aria-hidden
              d={`M${start.x.toFixed(1)},${start.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`}
              fill="none"
              strokeWidth={px(2.6)}
              strokeLinecap="round"
              className="stroke-sky"
              markerEnd="url(#officer-loan-head)"
            />
          );
        })}
        {layout.moves.map(({ index, move, from, to }) => {
          // A gentle curve (bowed to one side), stopping short of both squares (sized in pixels).
          const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
          const [unitX, unitY] = [(to.x - from.x) / length, (to.y - from.y) / length];
          const start = { x: from.x + unitX * px(from.size / 2 + 4), y: from.y + unitY * px(from.size / 2 + 4) };
          const end = { x: to.x - unitX * px(to.size / 2 + 7), y: to.y - unitY * px(to.size / 2 + 7) };
          const bow = Math.min(px(28), length * 0.25);
          const control = { x: (start.x + end.x) / 2 - unitY * bow, y: (start.y + end.y) / 2 + unitX * bow };
          // The curve's middle (t = 0.5 on the quadratic), where its number sits.
          const middle = { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y };
          const path = `M${start.x.toFixed(1)},${start.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
          const strong = highlightedMove === index || (highlightedMove === null && (selectedId === null || selectedId === move.fromCentreId || selectedId === move.toCentreId));
          return (
            <g key={`${move.fromCentreId}-${move.toCentreId}-${index}`} aria-hidden opacity={strong ? 1 : 0.3} className="transition-opacity duration-200">
              <path d={path} fill="none" strokeWidth={px(highlightedMove === index ? 3.2 : 2.4)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinecap="round" className="stroke-wheat-deep" markerEnd="url(#officer-move-head)" />
              <circle cx={middle.x} cy={middle.y} r={px(10)} className="fill-wheat-soft stroke-wheat-deep" strokeWidth={px(1.5)} />
              <text x={middle.x} y={middle.y} textAnchor="middle" dominantBaseline="central" className="fill-wheat-deep font-semibold" style={{ fontSize: px(12) }}>
                {index + 1}
              </text>
            </g>
          );
        })}

        {layout.centres.map(({ centre, state, size: units, x, y }) => {
          // Centre squares: 10 to 18 screen pixels by machines.
          const size = px(units);
          const selected = selectedId === centre.id;
          const side = labelPlacement.get(centre.id);
          return (
            <g
              key={centre.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={t("centreButton", { name: centre.name, state: t(`legendCentre_${state}`) })}
              onClick={(event) => {
                event.stopPropagation();
                choose(centre.id);
              }}
              onKeyDown={(event) => onCentreKey(event, centre.id)}
              opacity={isEmphasised(centre.id) ? 1 : 0.45}
              className="cursor-pointer outline-none transition-opacity duration-200 [&:focus-visible>.focus-ring]:opacity-100"
            >
              {/* A tap area 44px across. */}
              <circle cx={x} cy={y} r={px(22)} fill="transparent" />
              <rect className="focus-ring stroke-sky opacity-0" x={x - size / 2 - px(5)} y={y - size / 2 - px(5)} width={size + px(10)} height={size + px(10)} rx={px(6)} fill="none" strokeWidth={px(2)} />
              {selected ? <rect x={x - size / 2 - px(4)} y={y - size / 2 - px(4)} width={size + px(8)} height={size + px(8)} rx={px(5)} fill="none" className="stroke-ink" strokeWidth={px(2)} /> : null}
              <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={px(3)} className="stroke-surface" strokeWidth={px(2)} style={{ fill: CENTRE_FILL[state] }} />
              {side ? (
                <text
                  x={side === "right" ? x + size / 2 + px(5) : x - size / 2 - px(5)}
                  y={y + px(4.5)}
                  textAnchor={side === "right" ? "start" : "end"}
                  className={`fill-ink ${selected ? "font-semibold" : "font-medium"}`}
                  style={{ fontSize: px(13) }} paintOrder="stroke" stroke="var(--color-paper)" strokeWidth={px(4)} strokeLinejoin="round">
                  {centre.name.replace(/ CHC$/, "")}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {focused ? (
          <>
            <span className="font-medium text-ink">{focused.name}</span> · {centreNames.get(focused.centreId)} · {t("villageCounts", { fields: focused.fieldsActive, atRisk: focused.burnRisk, tight: focused.tight })}
          </>
        ) : (
          <>
            <span className="sm:hidden">{t("mapHintTouch")}</span>
            <span className="hidden sm:inline">{t("mapHint")}</span>
          </>
        )}
      </p>
    </div>
  );
}
