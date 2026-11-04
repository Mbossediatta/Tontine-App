import { useEffect, useState } from 'react';
import { Dices } from 'lucide-react';
import { fullName } from '@/lib/format';
import type { MemberView } from '@/types';

const MIN_DURATION_MS = 1800;
const TICK_MS = 90;

interface DrawAnimationProps {
  /** Noms affichés pendant le brassage. */
  names: string[];
  /** Résultat du tirage (null tant que le serveur n'a pas répondu). */
  result: MemberView[] | null;
}

/** Animation courte du tirage au sort, puis affichage de l'ordre obtenu. */
export function DrawAnimation({ names, result }: DrawAnimationProps) {
  const [index, setIndex] = useState(0);
  const [minElapsed, setMinElapsed] = useState(false);
  const done = minElapsed && result !== null;

  useEffect(() => {
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (done || names.length === 0) return;
    const interval = window.setInterval(() => setIndex((i) => (i + 1) % names.length), TICK_MS);
    return () => window.clearInterval(interval);
  }, [done, names.length]);

  if (!done) {
    return (
      <div className="flex flex-col items-center gap-4 py-6" role="status" aria-live="polite">
        <Dices className="h-12 w-12 animate-bounce text-blue-700" aria-hidden="true" />
        <p className="text-card-title text-ink">{names[index] ?? '…'}</p>
        <p className="text-label text-muted">Tirage au sort en cours…</p>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <p className="mb-3 text-label text-muted">Ordre des bénéficiaires :</p>
      <ol className="flex flex-col gap-2">
        {result.map((member, position) => (
          <li
            key={member.membership.id}
            className="flex animate-[fadeIn_300ms_ease-out_both] items-center gap-3 rounded-control bg-blue-50 p-3"
            style={{ animationDelay: `${position * 80}ms` }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-700 font-semibold tabular-nums text-white">
              {position + 1}
            </span>
            <span className="font-medium text-ink">
              {fullName(member.user)}
              {member.shareCount > 1 ? ` · part ${member.shareNumber}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
