import { useState } from 'react';
import { addMonths, addWeeks, format, startOfMonth, startOfWeek } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, Input, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/query';
import { groupService } from '@/services';
import type { Group } from '@/types';

function nextStartDate(group: Group): string {
  const now = new Date();
  const next =
    group.frequency === 'monthly'
      ? startOfMonth(addMonths(now, 1))
      : startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
  return format(next, 'yyyy-MM-dd');
}

const ORDER_CHOICES = [
  {
    keepOrder: true,
    title: 'Garder le même ordre',
    text: 'Chacun reçoit la cagnotte au même rang.',
  },
  {
    keepOrder: false,
    title: 'Refaire l’ordre',
    text: 'Nouveau tirage au sort ou ordre manuel avant le démarrage.',
  },
] as const;

/** Groupe terminé : relancer un nouveau cycle avec les mêmes membres. */
export function RestartCycleCard({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => nextStartDate(group));
  const [keepOrder, setKeepOrder] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');
  const restart = useAction({
    action: () =>
      groupService.restartCycle(group.id, {
        startDate: new Date(startDate).toISOString(),
        keepOrder,
      }),
    success: (updated: Group) =>
      `Cycle ${updated.currentCycle} préparé : le groupe repasse en brouillon`,
    onSuccess: () => setOpen(false),
  });

  return (
    <Card tone="positive" className="flex flex-col gap-3">
      <CardTitle>Cycle {group.currentCycle} terminé</CardTitle>
      <p className="text-label text-ink">
        Tous les membres ont reçu la cagnotte. Relancez la tontine avec les mêmes membres, sans
        recréer le groupe. L’historique des cycles précédents est conservé.
      </p>
      <OnlineButton
        block
        onClick={() => setOpen(true)}
        icon={<RotateCcw className="h-5 w-5" aria-hidden="true" />}
      >
        Relancer un nouveau cycle
      </OnlineButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Cycle ${group.currentCycle + 1}`}
        footer={
          <OnlineButton
            className="w-full sm:w-auto"
            loading={restart.isPending}
            disabled={!startDate || startDate < today}
            onClick={() => restart.mutate()}
          >
            Préparer le nouveau cycle
          </OnlineButton>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Date de démarrage"
            type="date"
            min={today}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={startDate && startDate < today ? 'Choisissez une date à venir' : undefined}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label text-muted">Ordre des bénéficiaires</legend>
            {ORDER_CHOICES.map((choice) => (
              <label
                key={String(choice.keepOrder)}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-card border-2 p-4 focus-within:outline focus-within:outline-[3px] focus-within:outline-green-300',
                  keepOrder === choice.keepOrder
                    ? 'border-blue-700 bg-blue-100'
                    : 'border-line bg-white',
                )}
              >
                <input
                  type="radio"
                  name="keep-order"
                  checked={keepOrder === choice.keepOrder}
                  onChange={() => setKeepOrder(choice.keepOrder)}
                  className="mt-1 h-5 w-5 accent-blue-700"
                />
                <span>
                  <span className="block font-bold text-ink">{choice.title}</span>
                  <span className="text-label text-muted">{choice.text}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-small text-muted">
            Le groupe repasse en brouillon : vous pourrez ajuster les membres et les règles, puis
            démarrer le cycle.
          </p>
        </div>
      </Modal>
    </Card>
  );
}
