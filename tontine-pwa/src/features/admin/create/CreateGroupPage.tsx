import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMonths, format, startOfMonth } from 'date-fns';
import { CheckCircle2 } from 'lucide-react';
import { FormProvider, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, Stepper } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useAction } from '@/lib/query';
import { CREATE_GROUP_STEPS, createGroupSchema, type CreateGroupValues } from '@/lib/validators';
import { groupService } from '@/services';
import type { Group, GroupKind } from '@/types';
import { InviteShare } from '../components/InviteShare';
import {
  JoinPolicyField,
  KindField,
  StepAttribution,
  StepInfo,
  StepRules,
  StepSummary,
} from './CreateGroupSteps';

type StepId = 'info' | 'rules' | 'attribution' | 'summary';

/** Étapes de l'assistant ; un Denthie n'a pas d'ordre de bénéficiaires (pas d'attribution). */
const STEPS: Record<GroupKind, ReadonlyArray<{ id: StepId; label: string; fields: number }>> = {
  tontine: [
    { id: 'info', label: 'Informations', fields: 0 },
    { id: 'rules', label: 'Règles', fields: 1 },
    { id: 'attribution', label: 'Attribution', fields: 2 },
    { id: 'summary', label: 'Récapitulatif', fields: 3 },
  ],
  denthie: [
    { id: 'info', label: 'Informations', fields: 0 },
    { id: 'rules', label: 'Épargne', fields: 1 },
    { id: 'summary', label: 'Récapitulatif', fields: 3 },
  ],
};

export default function CreateGroupPage() {
  const { isSuperAdmin, user } = useAuth();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<Group | null>(null);
  const form = useForm<CreateGroupValues>({
    resolver: zodResolver(createGroupSchema),
    mode: 'onTouched',
    defaultValues: {
      kind: 'tontine',
      name: '',
      description: '',
      frequency: 'daily',
      paymentDueDay: 1,
      paymentDueTime: '23:59',
      startDate: format(startOfMonth(addMonths(new Date(), 1)), 'yyyy-MM-dd'),
      attributionMode: 'random',
      turnLength: 10,
      sharesPerRound: 1,
      membershipFeeAmount: 0,
      reserveFinalTurn: true,
      collectMembershipFee: false,
      joinPolicy: 'invite',
    },
  });
  const create = useAction({
    action: (values: CreateGroupValues) =>
      groupService.create({
        ...values,
        photoUrl: values.photoUrl || undefined,
        startDate: new Date(values.startDate).toISOString(),
      }),
    success: (group) => (group.kind === 'denthie' ? 'Denthie créé' : 'Groupe créé'),
    onSuccess: setCreated,
  });

  /** Le super administrateur doit désigner l'admin responsable (un admin est choisi par défaut). */
  const adminMissing = () => {
    if (!isSuperAdmin || form.getValues('adminId')) return false;
    form.setError('adminId', { message: 'Choisissez l’administrateur responsable' });
    return true;
  };
  const communityMissing = () => {
    if (form.getValues('communityId')) return false;
    form.setError('communityId', {
      message: 'Choisissez la communauté qui accueillera ce groupe',
    });
    return true;
  };

  const steps = STEPS[form.watch('kind')];
  const current = steps[Math.min(step, steps.length - 1)] ?? steps[0];
  const last = step >= steps.length - 1;

  const next = async () => {
    const fields = current ? CREATE_GROUP_STEPS[current.fields] : undefined;
    const valid = fields && fields.length > 0 ? await form.trigger([...fields]) : true;
    if (step === 0 && (communityMissing() || adminMissing())) return;
    if (valid) setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  if (created) {
    // Groupe confié à un autre admin : son créateur n'y a plus accès.
    const canOpen = isSuperAdmin || created.adminId === user?.id;
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={created.kind === 'denthie' ? 'Denthie créé' : 'Groupe créé'} plain />
        <Card tone="positive" className="flex items-center gap-3 text-green-700">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          <p>
            « {created.name} » est prêt.{' '}
            {canOpen
              ? 'Invitez maintenant les participants.'
              : 'Son administrateur a été prévenu ; vous pouvez déjà partager le code d’invitation.'}
          </p>
        </Card>
        <InviteShare code={created.inviteCode} groupName={created.name} />
        <Link
          to={canOpen ? `/admin/groupes/${created.id}` : '/admin/mes-groupes'}
          className="inline-flex min-h-button items-center justify-center rounded-control border border-blue-700 bg-white px-5 font-semibold text-blue-700"
        >
          {canOpen ? 'Gérer le groupe' : 'Retour à mes groupes'}
        </Link>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <PageHeader
        title="Créer un groupe"
        backTo={isSuperAdmin ? '/admin/groupes' : '/admin/mes-groupes'}
        plain
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          if (!last) {
            event.preventDefault();
            void next();
            return;
          }
          void form.handleSubmit((values) => create.mutate(values))(event);
        }}
      >
        <Stepper steps={steps.map((item) => item.label)} current={step} />
        {current?.id === 'info' ? (
          <div className="flex flex-col gap-4">
            <KindField />
            <StepInfo />
            <JoinPolicyField />
          </div>
        ) : null}
        {current?.id === 'rules' ? <StepRules /> : null}
        {current?.id === 'attribution' ? <StepAttribution /> : null}
        {current?.id === 'summary' ? <StepSummary /> : null}
        <div className="sticky bottom-24 flex gap-3 bg-blue-50 py-2 lg:static">
          {step > 0 ? (
            <Button variant="secondary" className="flex-1" onClick={() => setStep((s) => s - 1)}>
              Précédent
            </Button>
          ) : null}
          {!last ? (
            <Button className="flex-1" onClick={() => void next()}>
              Suivant
            </Button>
          ) : (
            <OnlineButton type="submit" className="flex-1" loading={create.isPending}>
              {form.watch('kind') === 'denthie' ? 'Créer le Denthie' : 'Créer le groupe'}
            </OnlineButton>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
