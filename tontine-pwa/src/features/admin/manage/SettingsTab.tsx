import { useState } from 'react';
import { format } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, RefreshCw, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, ConfirmDialog, Input, Select, Textarea } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import { useAction } from '@/lib/query';
import { groupSettingsSchema, type GroupSettingsValues } from '@/lib/validators';
import { groupService } from '@/services';
import type { GroupOverview } from '@/types';
import { MAX_TURN_LENGTH } from '@/lib/tontine';
import {
  dueDayOptions,
  FREQUENCY_OPTIONS,
  PER_PERIOD,
  toOptionalNumber,
  TURN_UNIT,
} from '../create/formUtils';

export function SettingsTab({ overview }: { overview: GroupOverview }) {
  const { group } = overview;
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'code' | 'delete' | null>(null);
  const locked = group.status !== 'draft';
  const hasHistory = group.currentCycle > 1;
  const isOwner = overview.myRole === 'owner' || user.globalRole === 'super_admin';
  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<GroupSettingsValues>({
    resolver: zodResolver(groupSettingsSchema),
    values: {
      name: group.name,
      description: group.description ?? '',
      contributionAmount: group.contributionAmount,
      turnLength: group.turnLength,
      sharesPerRound: group.sharesPerRound ?? 1,
      membershipFeeAmount: group.membershipFeeAmount ?? 0,
      collectMembershipFee: (group.membershipFeeAmount ?? 0) > 0,
      reserveFinalTurn: group.reserveFinalTurn ?? false,
      frequency: group.frequency,
      maxMembers: group.maxMembers,
      paymentDueDay: group.paymentDueDay,
      paymentDueTime: group.paymentDueTime ?? '23:59',
      startDate: format(new Date(group.startDate), 'yyyy-MM-dd'),
      latePenalty: group.latePenalty,
    },
  });
  const frequency = watch('frequency');

  const save = useAction({
    action: (values: GroupSettingsValues) =>
      groupService.update(
        group.id,
        locked
          ? {
              name: values.name,
              description: values.description,
              paymentDueTime: values.paymentDueTime,
            }
          : { ...values, startDate: new Date(values.startDate).toISOString() },
      ),
    success: 'Réglages enregistrés',
  });
  const regenerate = useAction({
    action: () => groupService.regenerateInviteCode(group.id),
    success: (code: string) => `Nouveau code : ${code}`,
    onSuccess: () => setConfirm(null),
  });
  const remove = useAction({
    action: () => groupService.remove(group.id),
    success: 'Groupe supprimé',
    onSuccess: () => navigate('/admin', { replace: true }),
  });
  const numeric = { setValueAs: toOptionalNumber };

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <form
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="flex flex-col gap-3"
          noValidate
        >
          <CardTitle>Informations</CardTitle>
          <Input label="Nom du groupe" error={errors.name?.message} {...register('name')} />
          <Textarea
            label="Description"
            error={errors.description?.message}
            {...register('description')}
          />
          {locked ? (
            <p className="flex items-start gap-2 rounded-control bg-blue-50 p-3 text-label text-muted">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Le cycle a démarré : le montant, la fréquence et le nombre total de parts sont
              verrouillés pour protéger les participants.
            </p>
          ) : null}
          <Input
            label={`Cotisation ${PER_PERIOD[frequency]} et par part (FCFA)`}
            type="number"
            disabled={locked}
            error={errors.contributionAmount?.message}
            {...register('contributionAmount', numeric)}
          />
          <Select
            label="Rythme de cotisation"
            options={FREQUENCY_OPTIONS}
            disabled={locked}
            {...register('frequency')}
          />
          <Input
            label={`Durée d’un tour (en ${TURN_UNIT[frequency]})`}
            type="number"
            min={1}
            max={MAX_TURN_LENGTH[frequency]}
            disabled={locked}
            error={errors.turnLength?.message}
            {...register('turnLength', numeric)}
          />
          {frequency === 'daily' ? null : (
            <Select
              label="Jour limite de paiement (dans la dernière période du tour)"
              options={dueDayOptions(frequency)}
              disabled={locked}
              error={errors.paymentDueDay?.message}
              {...register('paymentDueDay', numeric)}
            />
          )}
          {/* Modifiable même après le démarrage (vaut pour les prochaines échéances). */}
          <Input
            label="Heure limite de paiement (heure de Dakar)"
            type="time"
            hint="Le jour limite, après cette heure (et le délai de grâce), le membre passe en retard et la pénalité s’applique."
            error={errors.paymentDueTime?.message}
            {...register('paymentDueTime')}
          />
          <Input
            label="Parts bénéficiaires payées par tour"
            type="number"
            min={1}
            max={50}
            disabled={locked}
            error={errors.sharesPerRound?.message}
            {...register('sharesPerRound', numeric)}
          />
          <Input
            label="Nombre total de parts"
            type="number"
            disabled={locked}
            error={errors.maxMembers?.message}
            {...register('maxMembers', numeric)}
          />
          <label className="flex items-center gap-3 text-label">
            <input type="checkbox" disabled={locked} {...register('reserveFinalTurn')} />
            Réserver la dernière période au Superadmin
          </label>
          <label className="flex items-center gap-3 text-label">
            <input type="checkbox" disabled={locked} {...register('collectMembershipFee')} />
            Activer les frais d’adhésion
          </label>
          {watch('collectMembershipFee') ? (
            <Input
              label="Frais d’adhésion par personne (FCFA)"
              type="number"
              min={1}
              disabled={locked}
              error={errors.membershipFeeAmount?.message}
              {...register('membershipFeeAmount', numeric)}
            />
          ) : null}
          <Input
            label="Date de démarrage"
            type="date"
            disabled={locked}
            error={errors.startDate?.message}
            {...register('startDate')}
          />
          <Input
            label="Pénalité de retard en FCFA (facultatif)"
            type="number"
            hint="Ajoutée d’office au montant dû dès que la date limite est dépassée."
            disabled={locked}
            error={errors.latePenalty?.message}
            {...register('latePenalty', numeric)}
          />
          <OnlineButton type="submit" block disabled={!isDirty} loading={save.isPending}>
            Enregistrer
          </OnlineButton>
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Code d’invitation</CardTitle>
        <p className="text-muted">
          Code actuel : <strong className="tracking-widest text-ink">{group.inviteCode}</strong>
        </p>
        <OnlineButton
          variant="secondary"
          block
          onClick={() => setConfirm('code')}
          icon={<RefreshCw className="h-5 w-5" aria-hidden="true" />}
        >
          Régénérer le code
        </OnlineButton>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Supprimer le groupe</CardTitle>
        <p className="text-label text-muted">
          {!isOwner
            ? 'Seul le propriétaire du groupe peut le supprimer.'
            : locked
              ? 'Seul un groupe en brouillon peut être supprimé.'
              : hasHistory
                ? 'Ce groupe a déjà des cycles terminés : son historique doit être conservé.'
                : 'Cette action est définitive.'}
        </p>
        <OnlineButton
          variant="danger"
          block
          disabled={!isOwner || locked || hasHistory}
          onClick={() => setConfirm('delete')}
          icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
        >
          Supprimer le groupe
        </OnlineButton>
      </Card>

      <ConfirmDialog
        open={confirm === 'code'}
        onClose={() => setConfirm(null)}
        onConfirm={() => regenerate.mutate()}
        loading={regenerate.isPending}
        title="Régénérer le code ?"
        confirmLabel="Régénérer"
      >
        L’ancien code et l’ancien lien d’invitation ne fonctionneront plus.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title="Supprimer ce groupe ?"
        confirmLabel="Supprimer définitivement"
        confirmText={group.name}
      >
        Tous les membres et invitations de « {group.name} » seront supprimés.
      </ConfirmDialog>
    </div>
  );
}
