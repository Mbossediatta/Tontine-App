import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardTitle, Input, Select, Textarea } from '@/components/ui';
import { queryKeys, useAction } from '@/lib/query';
import { financeService, groupService } from '@/services';
import { QueryState, Stat } from './PlatformUi';
import { money } from './labels';

/**
 * Revenus du Superadmin (frais d'adhésion, pénalités, période finale) et versement
 * facultatif d'une rémunération à l'admin d'un groupe, plafonnée à ses revenus.
 */
export function EarningsCard() {
  const [compensationGroupId, setCompensationGroupId] = useState('');
  const [compensationAmount, setCompensationAmount] = useState('');
  const [compensationNote, setCompensationNote] = useState('');
  const earnings = useQuery({
    queryKey: ['admin', 'platform-earnings'],
    queryFn: () => financeService.earnings(),
  });
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const compensate = useAction({
    action: () =>
      financeService.compensateAdmin(
        compensationGroupId,
        Number(compensationAmount),
        compensationNote,
      ),
    success: 'Rémunération versée à l’administrateur',
    onSuccess: () => {
      setCompensationAmount('');
      setCompensationNote('');
    },
  });
  const selectedIncome =
    earnings.data?.earnings
      .filter((entry) => entry.groupId === compensationGroupId)
      .reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
  const selectedCompensations =
    earnings.data?.compensations
      .filter((entry) => entry.groupId === compensationGroupId)
      .reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
  const selectedBalance = Math.max(0, selectedIncome - selectedCompensations);
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <CardTitle>Revenus du Superadmin et rémunération des admins</CardTitle>
        <p className="text-label text-muted">
          Frais d’adhésion, pénalités encaissées et période finale réservée. Les versements à
          l’admin sont facultatifs et plafonnés aux revenus disponibles de son groupe.
        </p>
      </div>
      <QueryState query={earnings}>
        {earnings.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Disponible"
                className="col-span-2 sm:order-last sm:col-span-1"
                value={money(earnings.data.available)}
              />
              <Stat label="Revenus encaissés" value={money(earnings.data.earnedTotal)} />
              <Stat label="Rémunérations admins" value={money(earnings.data.compensatedTotal)} />
            </div>
            <form
              className="grid gap-3 rounded-control border border-line p-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                compensate.mutate();
              }}
            >
              <Select
                label="Groupe et administrateur"
                value={compensationGroupId}
                onChange={(event) => setCompensationGroupId(event.target.value)}
                options={(groups.data ?? []).map(({ group, adminName }) => ({
                  value: group.id,
                  label: `${group.name} — ${adminName}`,
                }))}
                placeholder="Choisir un groupe"
                required
              />
              <Input
                label={`Montant à verser (disponible : ${money(selectedBalance)})`}
                type="number"
                min={1}
                max={selectedBalance}
                step={1}
                value={compensationAmount}
                onChange={(event) => setCompensationAmount(event.target.value)}
                required
              />
              <Textarea
                label="Motif du versement"
                value={compensationNote}
                onChange={(event) => setCompensationNote(event.target.value)}
                required
                minLength={3}
                className="sm:col-span-2"
              />
              <Button
                variant="blue"
                loading={compensate.isPending}
                disabled={
                  !compensationGroupId ||
                  !compensationAmount ||
                  Number(compensationAmount) < 1 ||
                  Number(compensationAmount) > selectedBalance ||
                  !compensationNote.trim()
                }
                className="sm:col-span-2 sm:justify-self-start"
              >
                Verser la rémunération
              </Button>
            </form>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 font-semibold">Revenus enregistrés</p>
                <ul className="divide-y divide-line text-label">
                  {earnings.data.earnings
                    .slice(-8)
                    .reverse()
                    .map((entry) => (
                      <li key={entry.id} className="flex justify-between gap-3 py-2">
                        <span>
                          {entry.kind === 'membership_fee'
                            ? 'Frais d’adhésion'
                            : entry.kind === 'late_penalty'
                              ? 'Pénalité de retard'
                              : 'Période finale'}{' '}
                          · {entry.groupName}
                        </span>
                        <strong>{money(entry.amount)}</strong>
                      </li>
                    ))}
                  {!earnings.data.earnings.length ? (
                    <li className="py-2 text-muted">Aucun revenu encaissé pour le moment.</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold">Rémunérations versées</p>
                <ul className="divide-y divide-line text-label">
                  {earnings.data.compensations
                    .slice(-8)
                    .reverse()
                    .map((entry) => (
                      <li key={entry.id} className="flex justify-between gap-3 py-2">
                        <span>
                          {entry.adminName} · {entry.groupName}
                        </span>
                        <strong>{money(entry.amount)}</strong>
                      </li>
                    ))}
                  {!earnings.data.compensations.length ? (
                    <li className="py-2 text-muted">Aucune rémunération versée.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </>
        ) : null}
      </QueryState>
    </Card>
  );
}
