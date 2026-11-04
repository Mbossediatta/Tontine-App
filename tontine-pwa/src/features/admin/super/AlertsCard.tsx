import { AlertTriangle, ChevronRight, Info, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AlertTone, PlatformAlert } from '@/types';

/** Fond, couleur du titre et icône de chaque ton d'alerte. */
const TONES: Record<AlertTone, { box: string; title: string; Icon: typeof Info }> = {
  danger: { box: 'bg-danger-bg', title: 'text-danger', Icon: XCircle },
  warning: { box: 'bg-warning-bg', title: 'text-warning', Icon: AlertTriangle },
  info: { box: 'bg-blue-100', title: 'text-blue-900', Icon: Info },
};

/** Contenu d'une alerte : icône, titre coloré et détail. */
function AlertBody({ alert }: { alert: PlatformAlert }) {
  const { title, Icon } = TONES[alert.tone];
  return (
    <>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', title)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={cn('block font-bold', title)}>{alert.title}</span>
        <span className="block text-label text-muted">{alert.detail}</span>
      </span>
    </>
  );
}

/**
 * « Alertes à traiter » : rouge pour les échecs de paiement, orange pour les retards,
 * bleu pour les demandes en attente. Une alerte avec une page associée est cliquable.
 */
export function AlertsCard({ alerts }: { alerts: PlatformAlert[] }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Alertes à traiter</CardTitle>
      {alerts.length === 0 ? (
        <p className="rounded-control bg-green-100 p-4 font-bold text-green-700">
          Aucune alerte : tout est en ordre.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const boxClass = cn('flex gap-3 rounded-control p-4', TONES[alert.tone].box);
            return (
              <li key={alert.id}>
                {alert.link ? (
                  <Link
                    to={alert.link}
                    className={cn(boxClass, 'transition-opacity hover:opacity-90')}
                  >
                    <AlertBody alert={alert} />
                    <ChevronRight
                      className="h-5 w-5 shrink-0 self-center text-muted"
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <div className={boxClass}>
                    <AlertBody alert={alert} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
