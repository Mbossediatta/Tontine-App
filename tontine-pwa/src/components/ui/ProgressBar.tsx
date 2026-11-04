interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  showLabel?: boolean;
}

/** Piste bleu clair, remplissage vert, libellé au-dessus (« 7 / 10 ont payé »). */
export function ProgressBar({ value, max, label, showLabel = true }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      {showLabel ? <span className="text-label tabular-nums text-muted">{label}</span> : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2 w-full overflow-hidden rounded-pill bg-blue-100"
      >
        <div
          className="h-full rounded-pill bg-green-600 transition-all duration-250"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
