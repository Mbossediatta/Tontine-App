import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Card, CardTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fullName } from '@/lib/format';
import type { Frequency, RoundView } from '@/types';

/** Nombre de tours affichés avant et après le tour en cours. */
const AROUND = 2;

/** Quand passera un tour à venir : le mois (« Décembre ») ou, si plusieurs tours par mois, le jour. */
function upcomingLabel(openDate: string, frequency: Frequency): string {
  const date = new Date(openDate);
  if (frequency !== 'monthly') return format(date, 'd MMM', { locale: fr });
  const month = format(date, 'MMMM', { locale: fr });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

interface PayoutOrderCardProps {
  groupId: string;
  frequency: Frequency;
  rounds: RoundView[];
  currentRoundId?: string;
}

/**
 * « Ordre de passage » autour du tour en cours : les deux derniers versés,
 * le tour en cours (pastille bleue) et les deux suivants.
 */
export function PayoutOrderCard({
  groupId,
  frequency,
  rounds,
  currentRoundId,
}: PayoutOrderCardProps) {
  const currentIndex = Math.max(
    0,
    rounds.findIndex((r) => r.round.id === currentRoundId),
  );
  const visible = rounds.slice(Math.max(0, currentIndex - AROUND), currentIndex + AROUND + 1);

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Ordre de passage</CardTitle>
      <ol className="flex flex-col gap-2">
        {visible.map(({ round, beneficiary }) => {
          const isCurrent = round.id === currentRoundId;
          const isPaid = round.status === 'paid_out';
          return (
            <li key={round.id} className="flex items-center gap-3">
              {/* Pastille du numéro : vert si versé, bleu plein si en cours, neutre sinon. */}
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label font-bold tabular-nums',
                  isCurrent
                    ? 'bg-blue-700 text-white'
                    : isPaid
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-50 text-muted',
                )}
              >
                {round.number}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-ink', isCurrent && 'font-bold')}>
                {fullName(beneficiary)}
                {round.beneficiaryShareCount && round.beneficiaryShareCount > 1
                  ? ` · part ${round.beneficiaryShareNumber}`
                  : ''}
              </span>
              <span className="text-small text-muted">
                {isPaid
                  ? 'Versé'
                  : isCurrent
                    ? 'En cours'
                    : upcomingLabel(round.openDate, frequency)}
              </span>
            </li>
          );
        })}
      </ol>
      <Link
        to={`/admin/groupes/${groupId}?onglet=tours`}
        className="font-bold text-blue-700 underline"
      >
        Modifier l’ordre
      </Link>
    </Card>
  );
}
