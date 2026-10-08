"use client";

/**
 * Slider on a native range input: keyboard (arrows, Home/End, Page keys) and screen readers work
 * as the platform does. The visible value is large; the touch target is 44px tall.
 */
import { useId } from "react";

type Props = {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** Spoken and shown value, e.g. "6 days, until Fri, 6 Nov". */
  valueText: string;
  minLabel: string;
  maxLabel: string;
};

export function Slider({ label, min, max, value, onChange, valueText, minLabel, maxLabel }: Props) {
  const id = useId();
  const fill = max === min ? 100 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      <label htmlFor={id} className="font-medium">{label}</label>
      <p className="mt-1 font-display text-3xl tabular" aria-hidden>{valueText}</p>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        className="vaari-slider mt-3 h-11 w-full cursor-pointer appearance-none bg-transparent"
        style={{ ["--fill" as string]: `${fill}%` }}
      />
      <div className="flex justify-between text-sm text-ink-muted tabular" aria-hidden>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
