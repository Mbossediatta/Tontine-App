// Gestion d'un Denthie (« garderie ») : épargne de la caisse, date de répartition,
// répartition finale et retraits d'urgence. Règles : migration …_denthie.sql.
import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { CalendarCheck, HandCoins, PiggyBank, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AmountText, RoundProgress } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import {
  AsyncContent,
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  Input,
  Modal,
  Textarea,
} from '@/components/ui';
import { useMembers, useRounds } from '@/features/groups/queries';
import { isPeriod } from '@/lib/denthie';
import { formatDate, fullName } from '@/lib/format';
import { formatPeriods } from '@/lib/tontine';
import { useAction } from '@/lib/query';
import { groupService } from '@/services';
import type { GroupOverview, PublicUser } from '@/types';
import { InviteShare } from '../components/InviteShare';
import { GROUP_STATUS_LABELS } from './labels';
import { RestartCycleCard } from './RestartCycleCard';
import { TransfersCard } from './TransfersCard';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

const today = () => format(new Date(), 'yyyy-MM-dd');

/** Date de répartition : fixée, changée ou retirée par l'admin ; les membres sont prévenus. */
function EndDateCard({ overview }: { overview: GroupOverview }) {
  const { group } = overview;
  const [value, setValue] = useState(group.endDate ? group.endDate.slice(0, 10) : '');
  const save = useAction({
    action: (date: string | null) => groupService.setEndDate(group.id, date),
    success: 'Date de répartition enregistrée : les membres sont prévenus',
  });
  if (group.status !== 'draft' && group.status !== 'active') return null;
  if (overview.savings?.distribution) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Date de répartition</CardTitle>
      <p className="text-label text-muted">
        {group.endDate
          ? `Prévue le ${formatDate(group.endDate)}. Les cotisations s’arrêtent à cette date ; ensuite vous lancez la répartition.`
          : 'Pas encore fixée : les périodes continuent. Choisissez la date quand le groupe l’a décidée ; chaque membre en sera prévenu.'}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Répartir l’argent le"
            type="date"
            min={today()}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <OnlineButton
          disabled={!value || value === group.endDate?.slice(0, 10)}
          loading={save.isPending}
          onClick={() => save.mutate(value)}
          icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
        >
          Enregistrer
        </OnlineButton>
      </div>
      {group.endDate ? (
        <Button
          variant="secondary"
          onClick={() => {
            setValue('');
            save.mutate(null);
          }}
        >
          Retirer la date (les cotisations continuent)
        </Button>
      ) : null}
    </Card>
  );
}

/** Répartition : à partir de la date prévue, chacun reçoit ce qu'il a versé. */
function DistributeCard({ overview }: { overview: GroupOverview }) {
  const { group, savings } = overview;
  const [confirm, setConfirm] = useState(false);
  const distribute = useAction({
    action: () => groupService.distribute(group.id),
    success: (result) =>
      result === 'pending_approval'
        ? 'Demande envoyée : le super admin doit valider cette répartition (300 000 FCFA ou plus)'
        : 'Répartition validée : envoyez maintenant à chacun sa part',
    onSuccess: () => setConfirm(false),
  });
  if (group.status !== 'active' || !group.endDate) return null;
  const reached = group.endDate.slice(0, 10) <= today();
  const pending = savings?.distribution?.payoutRequestedAt;
  return (
    <Card tone="pot" className="flex flex-col gap-3">
      <CardTitle>Répartition</CardTitle>
      <p className="text-label text-ink">
        Chaque membre reçoit ce qu’il a réellement versé, moins ses pénalités non réglées. Total
        dans la caisse : <AmountText value={savings?.total ?? 0} className="font-bold" />.
      </p>
      {pending ? (
        <p className="text-label text-blue-700">
          En attente de la validation du super admin (300 000 FCFA ou plus).
        </p>
      ) : (
        <OnlineButton
          block
          disabled={!reached}
          onClick={() => setConfirm(true)}
          icon={<HandCoins className="h-5 w-5" aria-hidden="true" />}
        >
          Lancer la répartition
        </OnlineButton>
      )}
      {!reached ? (
        <p className="text-label text-muted">Disponible à partir du {formatDate(group.endDate)}.</p>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => distribute.mutate()}
        loading={distribute.isPending}
        tone="primary"
        title="Lancer la répartition ?"
        confirmLabel="Répartir"
      >
        Les périodes encore ouvertes seront closes. Chaque membre recevra son épargne par Wave ou
        Orange Money (à envoyer ensuite dans « Épargne → Cagnottes à envoyer »). Le Denthie sera
        terminé.
      </ConfirmDialog>
    </Card>
  );
}

/** Aperçu d'un Denthie (remplace l'aperçu d'une tontine). */
export function DenthieOverviewTab({
  overview,
  onGoTo,
}: {
  overview: GroupOverview;
  onGoTo: (tab: 'membres' | 'tours') => void;
}) {
  const { group, currentRound, savings, activeShareCount } = overview;
  const [confirm, setConfirm] = useState(false);
  const start = useAction({
    action: () => groupService.start(group.id),
    success: 'Denthie démarré : la première période est ouverte',
    onSuccess: () => setConfirm(false),
  });
  const enoughPeople = overview.activeMemberCount >= 2;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="Statut">
            {GROUP_STATUS_LABELS[group.status]} · cycle {group.currentCycle}
          </Stat>
          <Stat label="Membres">
            <span className="tabular-nums">
              {overview.activeMemberCount} personne(s) · {activeShareCount} part(s)
            </span>
          </Stat>
          <Stat label="Période en cours">
            {savings?.currentPeriod ? `Période ${savings.currentPeriod}` : '—'}
          </Stat>
          <Stat label="Épargne dans la caisse">
            <AmountText value={savings?.total ?? 0} />
          </Stat>
          <Stat label="Date limite">{currentRound ? formatDate(currentRound.dueDate) : '—'}</Stat>
          <Stat label="Répartition">
            {group.endDate ? formatDate(group.endDate) : 'Date à fixer'}
          </Stat>
        </dl>
      </Card>

      {currentRound ? (
        <Card className="flex flex-col gap-3">
          <p className="text-label text-muted">
            Période {savings?.currentPeriod} · {formatPeriods(group.frequency, 1)} · cotisation de{' '}
            <AmountText value={group.contributionAmount} className="font-semibold text-ink" /> par
            part
          </p>
          <RoundProgress paid={overview.paidCount} total={activeShareCount} />
        </Card>
      ) : null}

      <DistributeCard overview={overview} />
      <EndDateCard overview={overview} />

      {group.status === 'finished' ? <RestartCycleCard group={group} /> : null}

      {group.status === 'draft' ? (
        <>
          <Card tone="info" className="flex flex-col gap-3">
            <p className="font-semibold text-ink">Avant de démarrer</p>
            <ul className="flex flex-col gap-1 text-label text-ink">
              <li>
                {enoughPeople ? '✓' : '•'} Au moins deux personnes inscrites (
                {overview.activeMemberCount}){' '}
                <button
                  type="button"
                  className="text-blue-700 underline"
                  onClick={() => onGoTo('membres')}
                >
                  gérer les membres
                </button>
              </li>
              <li>
                • Au démarrage, la liste est close : personne ne pourra rejoindre en cours de route.
              </li>
            </ul>
            <OnlineButton
              block
              disabled={!enoughPeople}
              onClick={() => setConfirm(true)}
              icon={<Play className="h-5 w-5" aria-hidden="true" />}
            >
              Démarrer le Denthie
            </OnlineButton>
          </Card>
          <InviteShare code={group.inviteCode} groupName={group.name} />
        </>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => start.mutate()}
        loading={start.isPending}
        title="Démarrer le Denthie ?"
        confirmLabel="Démarrer"
      >
        La première période sera ouverte et les membres invités à cotiser. Le montant, le rythme et
        la liste des membres ne pourront plus être modifiés.
      </ConfirmDialog>
    </div>
  );
}

/** Retrait d'urgence accordé par l'admin : la personne reçoit son épargne et quitte le Denthie. */
function WithdrawDialog({
  overview,
  person,
  onClose,
}: {
  overview: GroupOverview;
  person: PublicUser | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const withdraw = useAction({
    action: () => groupService.withdraw(overview.group.id, person?.id ?? '', reason),
    success: 'Retrait accordé : envoyez-lui son épargne (Cagnottes à envoyer)',
    onSuccess: () => {
      setReason('');
      onClose();
    },
  });
  const saved = person ? (overview.savings?.byUser[person.id] ?? 0) : 0;
  return (
    <Modal
      open={person !== null}
      onClose={onClose}
      title="Retrait d’urgence"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <OnlineButton
            className="flex-1"
            disabled={reason.trim().length < 4}
            loading={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            Accorder le retrait
          </OnlineButton>
        </div>
      }
    >
      {person ? (
        <div className="flex flex-col gap-3">
          <p className="text-ink">
            {fullName(person)} recevra son épargne :{' '}
            <AmountText value={saved} className="font-bold text-green-700" /> (moins ses pénalités
            non réglées), et ne cotisera plus dans ce Denthie.
          </p>
          <Textarea
            label="Raison de l’urgence"
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
    </Modal>
  );
}

/** Onglet « Épargne » : ce que chacun a mis de côté, envois d'argent, périodes. */
export function DenthieSavingsTab({ overview }: { overview: GroupOverview }) {
  const { group, savings } = overview;
  const members = useMembers(group.id);
  const rounds = useRounds(group.id);
  const [withdrawing, setWithdrawing] = useState<PublicUser | null>(null);
  const canWithdraw = group.status === 'active' && !savings?.distribution;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2">
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-blue-700" aria-hidden="true" />
            Épargne de chacun
          </span>
        </CardTitle>
        <AsyncContent query={members}>
          {(views) => {
            const people = [
              ...new Map(
                views
                  .filter((view) => view.membership.status === 'active')
                  .map((view) => [view.user.id, view]),
              ).values(),
            ];
            return (
              <ul className="flex flex-col divide-y divide-line">
                {people.map((view) => (
                  <li
                    key={view.user.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{fullName(view.user)}</span>
                      <span className="text-small text-muted">{view.shareCount} part(s)</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <AmountText
                        value={savings?.byUser[view.user.id] ?? 0}
                        className="font-bold tabular-nums text-ink"
                      />
                      {canWithdraw ? (
                        <Button variant="secondary" onClick={() => setWithdrawing(view.user)}>
                          Retrait d’urgence
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between gap-2 pt-2 font-bold text-ink">
                  <span>Total dans la caisse</span>
                  <AmountText value={savings?.total ?? 0} />
                </li>
              </ul>
            );
          }}
        </AsyncContent>
      </Card>

      <AsyncContent query={rounds}>
        {(views) => (
          <>
            <TransfersCard rounds={views} />
            <Card className="flex flex-col gap-2">
              <CardTitle>Périodes</CardTitle>
              <ol className="flex flex-col divide-y divide-line">
                {views
                  .filter((view) => isPeriod(view.round))
                  .map((view, index) => (
                    <li key={view.round.id} className="flex justify-between gap-2 py-2 text-label">
                      <span className="text-ink">
                        Période {index + 1} · jusqu’au {formatDate(view.round.dueDate)}
                      </span>
                      <span className="text-muted">
                        {view.round.status === 'paid_out'
                          ? `Close · ${view.paidCount}/${overview.activeShareCount} parts`
                          : `En cours · ${view.paidCount}/${overview.activeShareCount} parts`}
                      </span>
                    </li>
                  ))}
              </ol>
            </Card>
          </>
        )}
      </AsyncContent>

      <WithdrawDialog
        overview={overview}
        person={withdrawing}
        onClose={() => setWithdrawing(null)}
      />
    </div>
  );
}

/** Tableau de bord de l'admin : à la place du « prochain versement » d'une tontine. */
export function DenthieHomeCard({ overview }: { overview: GroupOverview }) {
  const { group, savings } = overview;
  return (
    <section className="flex flex-col gap-2 rounded-card bg-blue-700 p-5 text-white shadow-card">
      <p className="text-label text-blue-100">Denthie · épargne dans la caisse</p>
      <p className="font-display text-section tabular-nums">
        {(savings?.total ?? 0).toLocaleString('fr-FR')} FCFA
      </p>
      <p className="text-blue-100">
        {savings?.currentPeriod ? `Période ${savings.currentPeriod} · ` : ''}
        {group.endDate
          ? `répartition le ${formatDate(group.endDate)}`
          : 'date de répartition à fixer'}
      </p>
      <Link
        to={`/admin/groupes/${group.id}?onglet=tours`}
        className="inline-flex min-h-button items-center justify-center rounded-control bg-white px-4 font-bold text-blue-700 hover:bg-blue-100"
      >
        Voir l’épargne
      </Link>
    </section>
  );
}
