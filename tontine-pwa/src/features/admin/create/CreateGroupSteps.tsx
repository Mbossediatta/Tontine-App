import type { ReactNode } from 'react';
import { Dices, ListOrdered, LockKeyhole, UsersRound } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { AmountText } from '@/components/domain';
import { Card, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import type { CreateGroupValues } from '@/lib/validators';
import { useAdminChoices, useCommunities } from '../queries';
import { toOptionalNumber } from './formUtils';

/**
 * Administrateur du groupe, choisi parmi tous les admins actifs : il n'a pas à être
 * admin de la communauté (mais il peut l'être). Un admin de communauté qui crée le
 * groupe est proposé par défaut ; il peut le confier à un autre admin.
 */
function AdminField({ communityId }: { communityId?: string }) {
  const { isSuperAdmin, user } = useAuth();
  const admins = useAdminChoices();
  const communities = useCommunities();
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<CreateGroupValues>();
  const adminId = watch('adminId');
  useEffect(() => {
    if (!isSuperAdmin && user && !adminId) setValue('adminId', user.id);
  }, [isSuperAdmin, user, adminId, setValue]);
  const communityAdminIds =
    (communities.data ?? []).find((community) => community.id === communityId)?.adminIds ?? [];
  const delegated = !isSuperAdmin && !!adminId && adminId !== user?.id;
  return (
    <Select
      label="Administrateur du groupe"
      placeholder="Choisir l’administrateur…"
      hint={
        isSuperAdmin
          ? 'N’importe quel administrateur actif, qu’il gère ou non la communauté.'
          : delegated
            ? 'Vous confiez ce groupe : il le gérera seul et vous n’y aurez plus accès.'
            : 'Vous gérez ce groupe et y cotisez. Vous pouvez aussi le confier à un autre admin.'
      }
      error={errors.adminId?.message}
      options={(admins.data ?? []).map((admin) => ({
        value: admin.id,
        label: [
          admin.id === user?.id ? `${admin.name} (moi)` : admin.name,
          communityAdminIds.includes(admin.id) ? 'admin de la communauté' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }))}
      {...register('adminId')}
    />
  );
}

export function StepInfo() {
  const { isSuperAdmin, user } = useAuth();
  const communities = useCommunities();
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<CreateGroupValues>();
  const communityId = watch('communityId');
  const availableCommunities = useMemo(
    () =>
      (communities.data ?? []).filter(
        (community) => isSuperAdmin || community.adminIds.includes(user?.id ?? ''),
      ),
    [communities.data, isSuperAdmin, user?.id],
  );
  const selectedCommunityId = watch('communityId');
  useEffect(() => {
    if (!selectedCommunityId && availableCommunities.length === 1) {
      setValue('communityId', availableCommunities[0]?.id, { shouldValidate: true });
    }
  }, [availableCommunities, selectedCommunityId, setValue]);
  const communityRegistration = register('communityId');
  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Communauté"
        placeholder="Choisir la communauté…"
        hint={
          isSuperAdmin
            ? 'Le groupe et ses administrateurs seront rattachés à cet espace.'
            : availableCommunities.length === 0
              ? 'Demandez au super administrateur de vous affecter à une communauté.'
              : 'Le groupe sera rattaché à cette communauté.'
        }
        error={errors.communityId?.message}
        options={availableCommunities.map((community) => ({
          value: community.id,
          label: community.name,
        }))}
        {...communityRegistration}
        onChange={(event) => {
          communityRegistration.onChange(event);
          setValue('adminId', '');
        }}
      />
      <AdminField communityId={communityId} />
      <Input
        label="Nom du groupe"
        placeholder="Ex. Tontine Famille"
        error={errors.name?.message}
        {...register('name')}
      />
      <Textarea
        label="Description (facultatif)"
        error={errors.description?.message}
        {...register('description')}
      />
    </div>
  );
}

export function JoinPolicyField() {
  const { register, watch } = useFormContext<CreateGroupValues>();
  const joinPolicy = watch('joinPolicy');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label font-bold text-ink">Qui peut demander à rejoindre ?</legend>
      <label
        className={cn(
          'flex min-h-touch cursor-pointer items-start gap-3 rounded-control border p-3',
          joinPolicy === 'invite' ? 'border-blue-700 bg-blue-50' : 'border-line bg-white',
        )}
      >
        <input type="radio" value="invite" className="mt-1" {...register('joinPolicy')} />
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        <span>
          <strong className="block text-ink">Sur invitation</strong>
          <span className="text-small text-muted">Seules les personnes avec le code peuvent voir le groupe.</span>
        </span>
      </label>
      <label
        className={cn(
          'flex min-h-touch cursor-pointer items-start gap-3 rounded-control border p-3',
          joinPolicy === 'community' ? 'border-blue-700 bg-blue-50' : 'border-line bg-white',
        )}
      >
        <input type="radio" value="community" className="mt-1" {...register('joinPolicy')} />
        <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        <span>
          <strong className="block text-ink">Ouvert dans la communauté</strong>
          <span className="text-small text-muted">
            Les membres d’un groupe de cette communauté pourront le découvrir et demander à le rejoindre.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/** Aperçu en direct : cagnotte par tour et durée du cycle. */
export function LivePreview() {
  const { watch } = useFormContext<CreateGroupValues>();
  const [amount, members, duration, sharesPerRound, reserveFinalTurn, feeAmount] = watch([
    'contributionAmount',
    'maxMembers',
    'turnDurationDays',
    'sharesPerRound',
    'reserveFinalTurn',
    'membershipFeeAmount',
  ]);
  const periodCount =
    Math.ceil((members ?? 0) / Math.max(1, sharesPerRound ?? 1)) + (reserveFinalTurn ? 1 : 0);
  const pot = (amount ?? 0) * (duration ?? 0) * (members ?? 0);
  return (
    <Card tone="pot" className="text-ink" aria-live="polite">
      Cagnotte collectée par période : <AmountText value={pot} className="font-bold" /> ·{' '}
      {periodCount} période(s), soit {periodCount * (duration ?? 0)} jours.{' '}
      {feeAmount ? <>Frais d’adhésion : {feeAmount} FCFA par personne.</> : null}
    </Card>
  );
}

export function StepRules() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<CreateGroupValues>();
  const numeric = { setValueAs: toOptionalNumber };
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Cotisation journalière par part (FCFA)"
        type="number"
        inputMode="numeric"
        min={500}
        step={500}
        error={errors.contributionAmount?.message}
        {...register('contributionAmount', numeric)}
      />
      <Input
        label="Durée d’un tour (jours)"
        type="number"
        min={1}
        max={90}
        error={errors.turnDurationDays?.message}
        {...register('turnDurationDays', numeric)}
      />
      <Input
        label="Parts bénéficiaires payées par tour"
        type="number"
        min={1}
        max={50}
        hint="La cagnotte de la période est partagée entre les parts sélectionnées."
        error={errors.sharesPerRound?.message}
        {...register('sharesPerRound', numeric)}
      />
      <Input
        label="Nombre total de parts"
        type="number"
        inputMode="numeric"
        min={2}
        max={50}
        hint="Entre 2 et 50 parts. Une personne peut détenir plusieurs parts; au moins deux personnes sont nécessaires."
        error={errors.maxMembers?.message}
        {...register('maxMembers', numeric)}
      />
      <Input
        label="Date de démarrage"
        type="date"
        error={errors.startDate?.message}
        {...register('startDate')}
      />
      <Input
        label="Pénalité de retard en FCFA (facultatif)"
        type="number"
        inputMode="numeric"
        min={0}
        error={errors.latePenalty?.message}
        {...register('latePenalty', numeric)}
      />
      <label className="flex items-start gap-3 rounded-control border border-line bg-white p-3">
        <input type="checkbox" className="mt-1" {...register('reserveFinalTurn')} />
        <span>
          <strong className="block text-ink">Réserver la dernière période au Superadmin</strong>
          <span className="text-label text-muted">
            Les cotisations de cette période seront attribuées au Superadmin.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 rounded-control border border-line bg-white p-3">
        <input type="checkbox" className="mt-1" {...register('collectMembershipFee')} />
        <span>
          <strong className="block text-ink">Activer les frais d’adhésion</strong>
          <span className="text-label text-muted">
            Frais fixes dus une seule fois par personne, lors de son premier paiement.
          </span>
        </span>
      </label>
      {watch('collectMembershipFee') ? (
        <Input
          label="Frais d’adhésion par personne (FCFA)"
          type="number"
          min={1}
          error={errors.membershipFeeAmount?.message}
          {...register('membershipFeeAmount', numeric)}
        />
      ) : null}
      <LivePreview />
    </div>
  );
}

const MODES = [
  {
    id: 'random',
    title: 'Tirage au sort',
    text: 'L’ordre des bénéficiaires est tiré au hasard, visible de tous.',
    icon: Dices,
  },
  {
    id: 'manual',
    title: 'Ordre manuel',
    text: 'Vous fixez vous-même l’ordre avant le démarrage.',
    icon: ListOrdered,
  },
] as const;

export function StepAttribution() {
  const { register, watch } = useFormContext<CreateGroupValues>();
  const value = watch('attributionMode');
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-label text-muted">
        Comment choisir l’ordre des bénéficiaires ?
      </legend>
      {MODES.map(({ id, title, text, icon: Icon }) => (
        <label
          key={id}
          className={cn(
            'flex cursor-pointer gap-4 rounded-card border-2 bg-white p-4 focus-within:ring-2 focus-within:ring-blue-700',
            value === id ? 'border-blue-700 bg-blue-100' : 'border-line',
          )}
        >
          <input type="radio" value={id} className="sr-only" {...register('attributionMode')} />
          <Icon className="h-7 w-7 shrink-0 text-blue-700" aria-hidden="true" />
          <span>
            <span className="block font-semibold text-ink">{title}</span>
            <span className="text-label text-muted">{text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function StepSummary() {
  const { getValues } = useFormContext<CreateGroupValues>();
  const admins = useAdminChoices();
  const v = getValues();
  const admin = admins.data?.find((a) => a.id === v.adminId);
  const rows: Array<[string, ReactNode]> = [
    ['Nom', v.name],
    ...(admin ? [['Administrateur', admin.name] as [string, ReactNode]] : []),
    ['Description', v.description || '—'],
    ['Cotisation', <AmountText key="a" value={v.contributionAmount} />],
    ['Cotisation par', 'Jour et par part'],
    ['Durée d’un tour', `${v.turnDurationDays} jours`],
    ['Parts payées par tour', v.sharesPerRound],
    ['Parts du groupe', v.maxMembers],
    ['Démarrage', v.startDate ? formatDate(v.startDate) : '—'],
    ['Pénalité de retard', v.latePenalty ? <AmountText key="p" value={v.latePenalty} /> : 'Aucune'],
    [
      'Frais d’adhésion',
      v.collectMembershipFee ? `${v.membershipFeeAmount} FCFA / personne` : 'Désactivés',
    ],
    ['Dernière période Superadmin', v.reserveFinalTurn ? 'Oui' : 'Non'],
    ['Attribution', v.attributionMode === 'random' ? 'Tirage au sort' : 'Ordre manuel'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <dl className="flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <LivePreview />
    </div>
  );
}
