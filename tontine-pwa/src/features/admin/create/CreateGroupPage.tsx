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
import type { Group } from '@/types';
import { InviteShare } from '../components/InviteShare';
import {
  JoinPolicyField,
  StepAttribution,
  StepInfo,
  StepRules,
  StepSummary,
} from './CreateGroupSteps';

const STEP_LABELS = ['Informations', 'Règles', 'Attribution', 'Récapitulatif'] as const;

export default function CreateGroupPage() {
  const { isSuperAdmin, user } = useAuth();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<Group | null>(null);
  const form = useForm<CreateGroupValues>({
    resolver: zodResolver(createGroupSchema),
    mode: 'onTouched',
    defaultValues: {
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
      groupService.create({ ...values, startDate: new Date(values.startDate).toISOString() }),
    success: 'Groupe créé',
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

  const next = async () => {
    const fields = CREATE_GROUP_STEPS[step];
    const valid = fields && fields.length > 0 ? await form.trigger([...fields]) : true;
    if (step === 0 && (communityMissing() || adminMissing())) return;
    if (valid) setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  };

  if (created) {
    // Groupe confié à un autre admin : son créateur n'y a plus accès.
    const canOpen = isSuperAdmin || created.adminId === user?.id;
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Groupe créé" plain />
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
          if (step < STEP_LABELS.length - 1) {
            event.preventDefault();
            void next();
            return;
          }
          void form.handleSubmit((values) => create.mutate(values))(event);
        }}
      >
        <Stepper steps={STEP_LABELS} current={step} />
        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <StepInfo />
            <JoinPolicyField />
          </div>
        ) : null}
        {step === 1 ? <StepRules /> : null}
        {step === 2 ? <StepAttribution /> : null}
        {step === 3 ? <StepSummary /> : null}
        <div className="sticky bottom-24 flex gap-3 bg-blue-50 py-2 lg:static">
          {step > 0 ? (
            <Button variant="secondary" className="flex-1" onClick={() => setStep((s) => s - 1)}>
              Précédent
            </Button>
          ) : null}
          {step < STEP_LABELS.length - 1 ? (
            <Button className="flex-1" onClick={() => void next()}>
              Suivant
            </Button>
          ) : (
            <OnlineButton type="submit" className="flex-1" loading={create.isPending}>
              Créer le groupe
            </OnlineButton>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
