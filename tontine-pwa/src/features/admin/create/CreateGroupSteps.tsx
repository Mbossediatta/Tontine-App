import type { ReactNode } from 'react';
import { Dices, ListOrdered, LockKeyhole, PiggyBank, Repeat, UsersRound } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { AmountText } from '@/components/domain';
import { Card, GroupPhoto, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, frequencyLabel } from '@/lib/format';
import { formatCycleDuration, formatPeriods, MAX_TURN_LENGTH } from '@/lib/tontine';
import { useAuth } from '@/hooks/useAuth';
import type { CreateGroupValues } from '@/lib/validators';
import { GroupPhotoPicker } from '../components/GroupPhotoPicker';
import { useAdminChoices, useCommunities } from '../queries';
import {
  dueDayOptions,
  FREQUENCY_OPTIONS,
  PER_PERIOD,
  toOptionalNumber,
  TURN_UNIT,
} from './formUtils';

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
        placeholder={watch('kind') === 'denthie' ? 'Ex. Denthie Famille' : 'Ex. Tontine Famille'}
        error={errors.name?.message}
        {...register('name')}
      />
      <Textarea
        label="Description (facultatif)"
        error={errors.description?.message}
        {...register('description')}
      />
      <GroupPhotoPicker
        name={watch('name') ?? ''}
        value={watch('photoUrl')}
        onChange={(photoUrl) => setValue('photoUrl', photoUrl, { shouldDirty: true })}
      />
    </div>
  );
}

const KINDS = [
  {
    id: 'tontine',
    title: 'Tontine',
    text: 'À chaque tour, un membre (ou plusieurs) reçoit la cagnotte, jusqu’à ce que tout le monde l’ait reçue.',
    icon: Repeat,
  },
  {
    id: 'denthie',
    title: 'Denthie (garderie)',
    text: 'Chacun cotise à chaque période, l’argent est gardé, puis à la fin chacun récupère ce qu’il a versé.',
    icon: PiggyBank,
  },
] as const;

/**
 * Tontine ou Denthie. Passer au Denthie fixe ses règles : pas de durée de tour ni d'ordre
 * des bénéficiaires, pas de période de service ; pénalité de 250 FCFA par défaut.
 */
export function KindField() {
  const { register, setValue, getValues, watch } = useFormContext<CreateGroupValues>();
  const value = watch('kind');
  const registration = register('kind');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-label font-bold text-ink">Type de groupe</legend>
      {KINDS.map(({ id, title, text, icon: Icon }) => (
        <label
          key={id}
          className={cn(
            'flex cursor-pointer gap-4 rounded-card border-2 bg-white p-4 focus-within:ring-2 focus-within:ring-blue-700',
            value === id ? 'border-blue-700 bg-blue-100' : 'border-line',
          )}
        >
          <input
            type="radio"
            value={id}
            className="sr-only"
            {...registration}
            onChange={(event) => {
              void registration.onChange(event);
              if (id === 'denthie') {
                setValue('turnLength', 1);
                setValue('sharesPerRound', 1);
                setValue('reserveFinalTurn', false);
                setValue('attributionMode', 'manual');
                if (getValues('frequency') === 'daily') setValue('frequency', 'monthly');
                if (getValues('latePenalty') === undefined) setValue('latePenalty', 250);
              } else {
                setValue('turnLength', 10);
                setValue('reserveFinalTurn', true);
                setValue('attributionMode', 'random');
              }
            }}
          />
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
          <span className="text-small text-muted">
            Seules les personnes avec le code peuvent voir le groupe.
          </span>
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
            Les membres d’un groupe de cette communauté pourront le découvrir et demander à le
            rejoindre.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/** Denthie : ce qu'un membre épargne, et un exemple sur six périodes. */
function DenthiePreview() {
  const { watch } = useFormContext<CreateGroupValues>();
  const [amount, members, frequency, feeAmount, collectFee] = watch([
    'contributionAmount',
    'maxMembers',
    'frequency',
    'membershipFeeAmount',
    'collectMembershipFee',
  ]);
  const perPeriod = amount ?? 0;
  return (
    <Card tone="pot" className="text-ink" aria-live="polite">
      Chaque membre épargne <AmountText value={perPeriod} className="font-bold" />{' '}
      {PER_PERIOD[frequency]}. Par exemple, après {formatPeriods(frequency, 6)}, il aura mis de côté{' '}
      <AmountText value={perPeriod * 6} className="font-bold" /> et les récupère à la répartition ;
      avec {members ?? 0} membres, la caisse garde{' '}
      <AmountText value={perPeriod * 6 * (members ?? 0)} className="font-bold" />.{' '}
      {collectFee && feeAmount ? (
        <>
          Frais d’adhésion : {feeAmount} FCFA par personne (donnent accès au carnet électronique).
        </>
      ) : null}
    </Card>
  );
}

/** Aperçu en direct : cagnotte par tour et durée du cycle (ou épargne d'un Denthie). */
export function LivePreview() {
  const { watch } = useFormContext<CreateGroupValues>();
  return watch('kind') === 'denthie' ? <DenthiePreview /> : <TontinePreview />;
}

function TontinePreview() {
  const { watch } = useFormContext<CreateGroupValues>();
  const [amount, members, frequency, turnLength, sharesPerRound, reserveFinalTurn, feeAmount] =
    watch([
      'contributionAmount',
      'maxMembers',
      'frequency',
      'turnLength',
      'sharesPerRound',
      'reserveFinalTurn',
      'membershipFeeAmount',
    ]);
  const rounds =
    Math.ceil((members ?? 0) / Math.max(1, sharesPerRound ?? 1)) + (reserveFinalTurn ? 1 : 0);
  const perShare = (amount ?? 0) * (turnLength ?? 0);
  return (
    <Card tone="pot" className="text-ink" aria-live="polite">
      Chaque part cotise <AmountText value={perShare} className="font-bold" /> par tour · cagnotte
      d’un tour : <AmountText value={perShare * (members ?? 0)} className="font-bold" /> · {rounds}{' '}
      tour(s) de {formatPeriods(frequency, turnLength ?? 0)}, soit{' '}
      {formatCycleDuration(frequency, rounds, turnLength ?? 0)} au total.{' '}
      {feeAmount ? <>Frais d’adhésion : {feeAmount} FCFA par personne.</> : null}
    </Card>
  );
}

/** Rythme des versements d'un Denthie, en mots d'épargne. */
const SAVING_FREQUENCIES = [
  { value: 'daily', label: 'Chaque jour' },
  { value: 'weekly', label: 'Chaque semaine' },
  { value: 'biweekly', label: 'Toutes les deux semaines' },
  { value: 'monthly', label: 'Chaque mois' },
];

/**
 * Étape « Épargne » d'un Denthie : ce que chaque membre met de côté et quand. Pas de tours,
 * pas de parts : à la fin, chacun récupère ce qu'il a versé.
 */
function DenthieSavingRules() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<CreateGroupValues>();
  const numeric = { setValueAs: toOptionalNumber };
  const frequency = watch('frequency');
  return (
    <div className="flex flex-col gap-3">
      <Card tone="info" className="text-label text-ink">
        Chaque membre verse le même montant à chaque période. L’argent est gardé, personne ne le
        touche en cours de route ; à la fin, chacun récupère ce qu’il a versé.
      </Card>
      <Select
        label="Les membres versent"
        options={SAVING_FREQUENCIES}
        error={errors.frequency?.message}
        {...register('frequency')}
      />
      <Input
        label={`Montant à verser ${PER_PERIOD[frequency]} par chaque membre (FCFA)`}
        type="number"
        inputMode="numeric"
        min={500}
        step={500}
        error={errors.contributionAmount?.message}
        {...register('contributionAmount', numeric)}
      />
      {frequency === 'daily' ? null : (
        <Select
          label="Jour limite du versement"
          options={dueDayOptions(frequency)}
          error={errors.paymentDueDay?.message}
          {...register('paymentDueDay', numeric)}
        />
      )}
      <Input
        label="Heure limite du versement (heure de Dakar)"
        type="time"
        hint="Après cette heure, le jour limite, le membre qui n’a pas versé est en retard."
        error={errors.paymentDueTime?.message}
        {...register('paymentDueTime')}
      />
      <Input
        label="Date du premier versement (démarrage)"
        type="date"
        hint="La durée n’est pas fixée maintenant : vous choisirez la date de répartition plus tard, et les membres seront prévenus."
        error={errors.startDate?.message}
        {...register('startDate')}
      />
      <Input
        label="Nombre maximal de membres"
        type="number"
        inputMode="numeric"
        min={2}
        max={50}
        hint="Entre 2 et 50. Au démarrage, la liste est close : personne ne rejoint en cours de route."
        error={errors.maxMembers?.message}
        {...register('maxMembers', numeric)}
      />
      <Input
        label="Pénalité pour un versement manqué (FCFA)"
        type="number"
        inputMode="numeric"
        min={0}
        hint="Une seule fois par période manquée (250 FCFA proposés). Non réglée, elle est retenue à la répartition."
        error={errors.latePenalty?.message}
        {...register('latePenalty', numeric)}
      />
      <label className="flex items-start gap-3 rounded-control border border-line bg-white p-3">
        <input type="checkbox" className="mt-1" {...register('collectMembershipFee')} />
        <span>
          <strong className="block text-ink">Frais d’adhésion</strong>
          <span className="text-label text-muted">
            Payés une seule fois, avec le premier versement. Ils ouvrent le carnet électronique du
            membre (tous ses versements, à son nom, avec le logo du groupe).
          </span>
        </span>
      </label>
      {watch('collectMembershipFee') ? (
        <Input
          label="Frais d’adhésion par membre (FCFA)"
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

export function StepRules() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<CreateGroupValues>();
  const numeric = { setValueAs: toOptionalNumber };
  const frequency = watch('frequency');
  const denthie = watch('kind') === 'denthie';
  if (denthie) return <DenthieSavingRules />;
  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Rythme de cotisation"
        options={FREQUENCY_OPTIONS}
        error={errors.frequency?.message}
        {...register('frequency')}
      />
      <Input
        label={`Cotisation ${PER_PERIOD[frequency]} et par part (FCFA)`}
        type="number"
        inputMode="numeric"
        min={500}
        step={500}
        error={errors.contributionAmount?.message}
        {...register('contributionAmount', numeric)}
      />
      {denthie ? null : (
        <Input
          label={`Durée d’un tour (en ${TURN_UNIT[frequency]})`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_TURN_LENGTH[frequency]}
          hint={
            frequency === 'monthly'
              ? 'Par exemple 1 mois, 3 mois, ou 12 mois pour un an.'
              : `Jusqu’à ${formatPeriods(frequency, MAX_TURN_LENGTH[frequency])}.`
          }
          error={errors.turnLength?.message}
          {...register('turnLength', numeric)}
        />
      )}
      {frequency === 'daily' ? null : (
        <Select
          label={
            denthie
              ? 'Jour limite de paiement de chaque période'
              : 'Jour limite de paiement (dans la dernière période du tour)'
          }
          options={dueDayOptions(frequency)}
          error={errors.paymentDueDay?.message}
          {...register('paymentDueDay', numeric)}
        />
      )}
      <Input
        label="Heure limite de paiement (heure de Dakar)"
        type="time"
        hint="Le jour limite, après cette heure (et le délai de grâce), le membre passe en retard et la pénalité s’applique."
        error={errors.paymentDueTime?.message}
        {...register('paymentDueTime')}
      />
      {denthie ? null : (
        <Input
          label="Parts bénéficiaires payées par tour"
          type="number"
          min={1}
          max={50}
          hint="La cagnotte de la période est partagée entre les parts sélectionnées."
          error={errors.sharesPerRound?.message}
          {...register('sharesPerRound', numeric)}
        />
      )}
      <Input
        label={denthie ? 'Nombre maximal de membres' : 'Nombre total de parts'}
        type="number"
        inputMode="numeric"
        min={2}
        max={50}
        hint={
          denthie
            ? 'Entre 2 et 50. Chaque membre a une seule épargne. Au démarrage, la liste est close : personne ne rejoint en cours de route.'
            : 'Entre 2 et 50 parts. Une personne peut détenir plusieurs parts; au moins deux personnes sont nécessaires.'
        }
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
        label={denthie ? 'Pénalité de retard en FCFA' : 'Pénalité de retard en FCFA (facultatif)'}
        type="number"
        inputMode="numeric"
        min={0}
        hint={
          denthie
            ? 'Une seule fois par période non payée à l’heure limite (250 FCFA proposés). Non réglée, elle est retenue à la répartition.'
            : undefined
        }
        error={errors.latePenalty?.message}
        {...register('latePenalty', numeric)}
      />
      {denthie ? null : (
        <label className="flex items-start gap-3 rounded-control border border-line bg-white p-3">
          <input type="checkbox" className="mt-1" {...register('reserveFinalTurn')} />
          <span>
            <strong className="block text-ink">Réserver la dernière période au Superadmin</strong>
            <span className="text-label text-muted">
              Les cotisations de cette période seront attribuées au Superadmin.
            </span>
          </span>
        </label>
      )}
      <label className="flex items-start gap-3 rounded-control border border-line bg-white p-3">
        <input type="checkbox" className="mt-1" {...register('collectMembershipFee')} />
        <span>
          <strong className="block text-ink">Activer les frais d’adhésion</strong>
          <span className="text-label text-muted">
            {denthie
              ? 'Frais fixes dus une seule fois par personne, lors de son premier paiement. Ils donnent accès au carnet électronique (tous ses versements, au nom du membre, avec le logo du groupe).'
              : 'Frais fixes dus une seule fois par personne, lors de son premier paiement.'}
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

/** Récapitulatif d'un Denthie : ni durée de tour, ni ordre, ni période de service. */
function denthieRows(v: CreateGroupValues, adminName?: string): Array<[string, ReactNode]> {
  return [
    ['Type', 'Denthie (garderie)'],
    ['Nom', v.name],
    ...(adminName ? [['Administrateur', adminName] as [string, ReactNode]] : []),
    ['Description', v.description || '—'],
    ['Cotisation', <AmountText key="a" value={v.contributionAmount} />],
    ['Rythme', frequencyLabel(v.frequency)],
    ['Cotisation par membre', PER_PERIOD[v.frequency]],
    ['Membres au plus', v.maxMembers],
    ['Démarrage', v.startDate ? formatDate(v.startDate) : '—'],
    ['Durée', 'À fixer plus tard (date de répartition)'],
    ['Heure limite', v.paymentDueTime ? v.paymentDueTime.replace(':', 'h') : '—'],
    ['Pénalité de retard', v.latePenalty ? <AmountText key="p" value={v.latePenalty} /> : 'Aucune'],
    [
      'Frais d’adhésion',
      v.collectMembershipFee ? `${v.membershipFeeAmount} FCFA / personne` : 'Désactivés',
    ],
  ];
}

export function StepSummary() {
  const { getValues } = useFormContext<CreateGroupValues>();
  const admins = useAdminChoices();
  const v = getValues();
  const admin = admins.data?.find((a) => a.id === v.adminId);
  const rows: Array<[string, ReactNode]> =
    v.kind === 'denthie'
      ? denthieRows(v, admin?.name)
      : [
          ['Nom', v.name],
          ...(admin ? [['Administrateur', admin.name] as [string, ReactNode]] : []),
          ['Description', v.description || '—'],
          ['Cotisation', <AmountText key="a" value={v.contributionAmount} />],
          ['Rythme', frequencyLabel(v.frequency)],
          ['Cotisation par', `${PER_PERIOD[v.frequency].replace('par ', '')} et par part`],
          ['Durée d’un tour', formatPeriods(v.frequency, v.turnLength)],
          ['Parts payées par tour', v.sharesPerRound],
          ['Parts du groupe', v.maxMembers],
          ['Démarrage', v.startDate ? formatDate(v.startDate) : '—'],
          ['Heure limite', v.paymentDueTime ? v.paymentDueTime.replace(':', 'h') : '—'],
          [
            'Pénalité de retard',
            v.latePenalty ? <AmountText key="p" value={v.latePenalty} /> : 'Aucune',
          ],
          [
            'Frais d’adhésion',
            v.collectMembershipFee ? `${v.membershipFeeAmount} FCFA / personne` : 'Désactivés',
          ],
          [
            'Période de service de la plateforme',
            v.reserveFinalTurn
              ? 'Oui : une période en fin de cycle, où chaque membre paie une partie de sa cotisation (part réglée par la plateforme)'
              : 'Non',
          ],
          ['Attribution', v.attributionMode === 'random' ? 'Tirage au sort' : 'Ordre manuel'],
        ];
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <GroupPhoto name={v.name} src={v.photoUrl} size="md" />
          <div className="min-w-0">
            <p className="truncate text-card-title text-ink">{v.name}</p>
            <p className="text-small text-muted">
              {v.photoUrl ? 'Photo du groupe choisie' : 'Sans photo : les initiales s’affichent'}
            </p>
          </div>
        </div>
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
