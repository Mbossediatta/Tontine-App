/** Barre de recouvrement : piste bleu clair, remplissage vert, pourcentage à droite. */
export function RecoveryBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-label text-muted">Aucun tour échu</span>;
  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-label="Taux de recouvrement"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate}
        className="h-2 w-24 overflow-hidden rounded-pill bg-blue-100"
      >
        <span className="block h-full rounded-pill bg-green-600" style={{ width: `${rate}%` }} />
      </span>
      <span className="font-bold tabular-nums text-ink">{rate} %</span>
    </span>
  );
}
