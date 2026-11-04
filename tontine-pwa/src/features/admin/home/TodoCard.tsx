import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardTitle, type BadgeTone } from '@/components/ui';
import type { TodoItem, TodoKind } from '@/types';

/**
 * Libellé et couleur du badge de chaque tâche.
 * Le `Record<TodoKind, …>` oblige à couvrir chaque type de tâche : en ajouter un
 * dans `TodoKind` sans l'ajouter ici est refusé à la compilation.
 */
const TODO_LABELS: Record<TodoKind, { label: string; tone: BadgeTone }> = {
  join_request: { label: 'Adhésion', tone: 'warning' },
  ready_for_payout: { label: 'Versement', tone: 'success' },
  failed_payment: { label: 'Échec', tone: 'danger' },
  swap_request: { label: 'Échange', tone: 'info' },
};

/** « À traiter » : demandes et événements qui attendent une décision de l'admin. */
export function TodoCard({ items }: { items: TodoItem[] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <CardTitle className="px-4 pt-4">À traiter</CardTitle>
      {items.length > 0 ? (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/admin/groupes/${item.groupId}`}
                className="flex min-h-touch items-center gap-3 p-4 transition-colors duration-150 hover:bg-blue-50"
              >
                <Badge tone={TODO_LABELS[item.kind].tone}>{TODO_LABELS[item.kind].label}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-ink">{item.label}</span>
                  <span className="text-small text-muted">{item.groupName}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-4 pb-4 text-label text-green-700">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          Aucune tâche urgente pour le moment.
        </p>
      )}
    </Card>
  );
}
