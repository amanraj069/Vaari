/** Step progress for short forms: bars plus step names; the current step is announced. */
export function StepProgress({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => (
        <li key={step} aria-current={index === current ? "step" : undefined}>
          <div className={`h-1.5 rounded-full ${index <= current ? "bg-wheat" : "bg-line"}`} />
          <span className={`mt-1 block truncate text-xs ${index === current ? "font-medium text-ink" : "text-ink-muted"}`}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
