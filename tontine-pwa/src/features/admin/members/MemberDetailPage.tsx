import { useState, type ReactNode } from 'react';
import { ChevronRight, KeyRound, Lock, LockOpen, Phone, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AmountText, GroupStatusBadge, StatusBadge } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Badge, Button, Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { formatDate, formatPhone, fullName, paymentMethodLabel, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { memberService } from '@/services';
import type { GroupRole } from '@/types';
import { headerLinkClass } from '../components/linkStyles';
import { StatCard } from '../components/StatCard';
import { useMemberProfile } from '../queries';
import { ChangePhoneDialog } from './ChangePhoneDialog';

const ROLE_LABELS: Record<GroupRole, string> = {
  owner: 'Propriétaire',
  co_admin: 'Co-admin',
  member: 'Membre',
};

/** Paiements affichés avant « Afficher tout ». */
const PAYMENTS_PREVIEW = 8;

type ConfirmKind = 'block' | 'unblock' | 'resetPin';

const CONFIRMS: Record<
  ConfirmKind,
  { title: string; confirm: string; tone: 'blue' | 'danger'; success: string; body: string }
> = {
  block: {
    title: 'Bloquer ce compte ?',
    confirm: 'Bloquer',
    tone: 'danger',
    success: 'Compte bloqué',
    body: 'La personne ne pourra plus se connecter. Ses groupes et son historique restent intacts.',
  },
  unblock: {
    title: 'Débloquer ce compte ?',
    confirm: 'Débloquer',
    tone: 'blue',
    success: 'Compte débloqué',
    body: 'La personne pourra de nouveau se connecter.',
  },
  resetPin: {
    title: 'Réinitialiser son PIN ?',
    confirm: 'Réinitialiser',
    tone: 'blue',
    success: 'PIN réinitialisé',
    body: 'À sa prochaine connexion, elle recevra un code par SMS et créera un nouveau PIN.',
  },
};

/** Carte de section avec titre, et un message quand la liste est vide. */
function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <CardTitle className="px-4 pt-4">{title}</CardTitle>
      {children ?? <p className="px-4 pb-4 pt-2 text-muted">{empty}</p>}
    </Card>
  );
}

/**
 * Fiche d'un membre (super administrateur) : ses groupes, paiements, retards et tours
 * reçus, avec les actions bloquer / débloquer, réinitialiser le PIN, changer le numéro.
 */
export default function MemberDetailPage() {
  const { id = '' } = useParams();
  const query = useMemberProfile(id);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [changingPhone, setChangingPhone] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);

  const run = useAction({
    action: (kind: ConfirmKind) =>
      kind === 'block'
        ? memberService.block(id)
        : kind === 'unblock'
          ? memberService.unblock(id)
          : memberService.resetPin(id),
    success: () => (confirm ? CONFIRMS[confirm].success : 'Fait'),
    onSuccess: () => setConfirm(null),
  });

  return (
    <AsyncContent query={query} errorMessage="Ce membre est introuvable.">
      {({ summary, groups, payments, lates, received }) => {
        const { user } = summary;
        const paidCount = payments.filter((p) => p.payment.status === 'paid').length;
        const shownPayments = showAllPayments ? payments : payments.slice(0, PAYMENTS_PREVIEW);
        return (
          <div className="flex flex-col gap-6">
            <PageHeader
              title={fullName(user)}
              plain
              backTo="/admin/membres"
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{formatPhone(user.phone)}</span>
                  <Badge tone={user.globalRole === 'admin' ? 'admin' : 'neutral'}>
                    {user.globalRole === 'admin' ? 'Administrateur' : 'Participant'}
                  </Badge>
                  <Badge tone={user.isSuspended ? 'danger' : 'success'}>
                    {user.isSuspended ? 'Bloqué' : 'Actif'}
                  </Badge>
                  {summary.pinPending ? (
                    <Badge
                      tone="info"
                      icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                    >
                      PIN à créer
                    </Badge>
                  ) : null}
                </span>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
              <div className="flex flex-col gap-6">
                <section
                  className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4"
                  aria-label="Chiffres clés"
                >
                  <StatCard label="Groupes" value={summary.groupCount} />
                  <StatCard label="Paiements réussis" value={paidCount} />
                  <StatCard
                    label="Retards en cours"
                    value={lates.length}
                    hintTone={lates.length > 0 ? 'warning' : 'positive'}
                    hint={
                      lates.length > 0 ? (
                        <AmountText value={lates.reduce((sum, l) => sum + l.amount, 0)} />
                      ) : (
                        'À jour'
                      )
                    }
                  />
                  <StatCard label="Cagnottes reçues" value={received.length} />
                </section>

                {lates.length > 0 ? (
                  <Section title="Retards">
                    <ul className="mt-2 divide-y divide-line">
                      {lates.map((late) => (
                        <li
                          key={late.groupId}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-ink">
                              {late.groupName}
                            </span>
                            <span className="text-small text-muted">Tour {late.roundNumber}</span>
                          </span>
                          <AmountText value={late.amount} className="font-bold text-warning" />
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}

                <Section title="Ses groupes" empty="Ne fait partie d’aucun groupe.">
                  {groups.length > 0 ? (
                    <ul className="mt-2 divide-y divide-line">
                      {groups.map(({ group, role, status, shareCount }) => (
                        <li key={group.id}>
                          <Link
                            to={`/admin/groupes/${group.id}`}
                            className="flex min-h-touch items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-blue-50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold text-ink">
                                {group.name}
                              </span>
                              <span className="text-small text-muted">
                                {ROLE_LABELS[role]}
                                {status === 'pending'
                                  ? ' · demande en attente'
                                  : ` · ${shareCount} part(s)`}
                              </span>
                            </span>
                            <GroupStatusBadge status={group.status} />
                            <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : undefined}
                </Section>

                <Section title="Historique des paiements" empty="Aucun paiement pour le moment.">
                  {payments.length > 0 ? (
                    <>
                      <ul className="mt-2 divide-y divide-line">
                        {shownPayments.map(({ payment, groupName, roundNumber }) => {
                          const date = payment.paidAt ?? payment.createdAt;
                          return (
                            <li
                              key={payment.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-bold text-ink">
                                  {groupName} · tour {roundNumber}
                                </span>
                                <span className="text-small text-muted">
                                  {date ? formatDate(date) : '—'} ·{' '}
                                  {paymentMethodLabel(payment.method)}
                                </span>
                              </span>
                              <span className="flex flex-col items-end gap-1">
                                <AmountText value={payment.amount} className="font-bold text-ink" />
                                <StatusBadge status={payment.status} />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {payments.length > PAYMENTS_PREVIEW ? (
                        <div className="border-t border-line p-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={() => setShowAllPayments((v) => !v)}
                          >
                            {showAllPayments
                              ? 'Afficher moins'
                              : `Afficher les ${plural(payments.length, 'paiement')}`}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : undefined}
                </Section>

                <Section title="Cagnottes reçues" empty="N’a pas encore reçu de cagnotte.">
                  {received.length > 0 ? (
                    <ul className="mt-2 divide-y divide-line">
                      {received.map(({ groupId, groupName, round }) => (
                        <li
                          key={round.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <span className="min-w-0">
                            <Link
                              to={`/admin/groupes/${groupId}`}
                              className="block truncate font-bold text-ink hover:text-blue-700"
                            >
                              {groupName} · tour {round.number}
                            </Link>
                            <span className="text-small text-muted">
                              {round.paidOutAt ? `Versée le ${formatDate(round.paidOutAt)}` : ''}
                            </span>
                          </span>
                          <AmountText
                            value={round.potAmount}
                            className="font-bold text-green-700"
                          />
                        </li>
                      ))}
                    </ul>
                  ) : undefined}
                </Section>
              </div>

              <Card className="flex flex-col gap-2">
                <CardTitle>Actions</CardTitle>
                <OnlineButton
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setChangingPhone(true)}
                  icon={<Phone className="h-5 w-5" aria-hidden="true" />}
                >
                  Changer le numéro
                </OnlineButton>
                <OnlineButton
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setConfirm('resetPin')}
                  icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
                >
                  Réinitialiser le PIN
                </OnlineButton>
                {user.isSuspended ? (
                  <OnlineButton
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setConfirm('unblock')}
                    icon={<LockOpen className="h-5 w-5" aria-hidden="true" />}
                  >
                    Débloquer le compte
                  </OnlineButton>
                ) : (
                  <OnlineButton
                    variant="danger"
                    className="w-full justify-start"
                    onClick={() => setConfirm('block')}
                    icon={<Lock className="h-5 w-5" aria-hidden="true" />}
                  >
                    Bloquer le compte
                  </OnlineButton>
                )}
                {user.globalRole === 'admin' ? (
                  <Link
                    to={`/admin/administrateurs/${user.id}`}
                    className={`${headerLinkClass.outline} w-full`}
                  >
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    Voir sa fiche administrateur
                  </Link>
                ) : null}
              </Card>
            </div>

            <ChangePhoneDialog
              user={user}
              open={changingPhone}
              onClose={() => setChangingPhone(false)}
            />
            <ConfirmDialog
              open={confirm !== null}
              onClose={() => setConfirm(null)}
              onConfirm={() => confirm && run.mutate(confirm)}
              loading={run.isPending}
              tone={confirm ? CONFIRMS[confirm].tone : 'blue'}
              title={confirm ? CONFIRMS[confirm].title : ''}
              confirmLabel={confirm ? CONFIRMS[confirm].confirm : ''}
            >
              {confirm ? (
                <p>
                  <strong>{fullName(user)}</strong> — {CONFIRMS[confirm].body}
                </p>
              ) : null}
            </ConfirmDialog>
          </div>
        );
      }}
    </AsyncContent>
  );
}
