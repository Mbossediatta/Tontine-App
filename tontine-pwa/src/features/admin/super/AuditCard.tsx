import { Card, CardTitle } from '@/components/ui';
import { formatMoment } from '@/lib/format';
import type { AuditView } from '@/types';

/** « Journal d'audit » : les dernières actions sensibles, qui les a faites et quand. */
export function AuditCard({ entries }: { entries: AuditView[] }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Journal d’audit</CardTitle>
      {entries.length === 0 ? (
        <p className="text-muted">Aucune action enregistrée pour le moment.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map(({ entry, actorName }) => (
            <li key={entry.id} className="flex gap-3">
              {/* Puce bleue alignée sur la première ligne de texte. */}
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ink">
                  <span className="font-bold">{actorName}</span> {entry.summary}
                </p>
                <p className="text-small text-muted">
                  <time dateTime={entry.at}>{formatMoment(entry.at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
