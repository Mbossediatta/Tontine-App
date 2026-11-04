import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Coins,
  Plus,
  UserPlus,
  Users,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AsyncContent, EmptyState, PageSkeleton } from '@/components/ui';
import { GroupStatusBadge } from '@/components/domain';
import { useRounds } from '@/features/groups/queries';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatAmount, formatDate, formatMonth, plural } from '@/lib/format';
import type { GroupOverview, GroupStatus } from '@/types';
import { DashboardHeader } from '../components/DashboardHeader';
import { headerLinkClass } from '../components/linkStyles';
import { StatCard } from '../components/StatCard';
import { useAdminDashboard } from '../queries';
import { ContributionsCard } from './ContributionsCard';
import { NextPayoutCard } from './NextPayoutCard';
import { PayoutOrderCard } from './PayoutOrderCard';
import { QuickActionsCard } from './QuickActionsCard';
import { TodoCard } from './TodoCard';

/** Ordre des onglets de groupes : en cours d'abord, terminés en dernier. */
const STATUS_ORDER: Record<GroupStatus, number> = {
  active: 0,
  draft: 1,
  suspended: 2,
  finished: 3,
};

const iconClass = 'h-5 w-5';

/** « novembre 2026 » → « Novembre 2026 ». */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Espace du groupe choisi. L'ordre du code est celui du téléphone : le prochain
 * versement d'abord (action la plus urgente), puis les cotisations, l'ordre de
 * passage et les actions rapides.
 * À partir de 1280 px : cotisations à gauche, les trois autres cartes empilées à
 * droite. La 4e rangée (1fr) absorbe la hauteur du tableau, pour que les cartes
 * de droite restent collées les unes aux autres.
 */
function GroupWorkspace({ overview }: { overview: GroupOverview }) {
  const rounds = useRounds(overview.group.id);
  const current = rounds.data?.find((r) => r.round.id === overview.currentRound?.id);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_auto_auto_1fr] xl:items-start">
      {current ? (
        <div className="xl:col-start-2 xl:row-start-1">
          <NextPayoutCard overview={overview} round={current} />
        </div>
      ) : null}
      <div className="xl:col-start-1 xl:row-span-4 xl:row-start-1">
        <ContributionsCard overview={overview} />
      </div>
      {rounds.data && rounds.data.length > 0 ? (
        <div className="xl:col-start-2 xl:row-start-2">
          <PayoutOrderCard
            groupId={overview.group.id}
            frequency={overview.group.frequency}
            rounds={rounds.data}
            currentRoundId={overview.currentRound?.id}
          />
        </div>
      ) : null}
      <div className="xl:col-start-2 xl:row-start-3">
        <QuickActionsCard overview={overview} />
      </div>
    </div>
  );
}

/**
 * Tableau de bord d'un administrateur :
 *
 * 1. Indicateurs et tâches urgentes de ses groupes.
 * 2. Prochain versement, puis un aperçu de tous ses groupes.
 * 3. Détail du groupe choisi : cotisations, ordre de passage et actions rapides.
 */
export function AdminHome() {
  const { user } = useAuth();
  const query = useAdminDashboard();
  // Groupe affiché ; par défaut le premier de la liste (un groupe en cours si possible).
  const [selectedId, setSelectedId] = useState<string>();
  const now = new Date();

  return (
    <AsyncContent query={query} skeleton={<PageSkeleton />}>
      {(data) => {
        const groups = [...data.groups].sort(
          (a, b) => STATUS_ORDER[a.group.status] - STATUS_ORDER[b.group.status],
        );
        const selected = groups.find((g) => g.group.id === selectedId) ?? groups[0];
        const next = data.nextPayout;

        return (
          <div className="flex flex-col gap-6">
            <DashboardHeader
              title={`Bonjour ${user?.firstName ?? ''}`}
              subtitle={`Vos groupes de tontine · ${capitalize(formatMonth(now))}`}
              showBell={false}
              actions={
                <>
                  {selected ? (
                    <Link
                      to={`/admin/groupes/${selected.group.id}?onglet=membres`}
                      className={headerLinkClass.outline}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      Ajouter un membre
                    </Link>
                  ) : null}
                  <Link to="/admin/groupes/nouveau" className={headerLinkClass.blue}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Créer un groupe
                  </Link>
                </>
              }
            />

            {/* 1. Indicateurs */}
            {/* 1 colonne sous 360 px, 2 sur téléphone, 4 sur ordinateur. */}
            <section
              className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4"
              aria-label="Indicateurs"
            >
              <StatCard
                label="Mes groupes actifs"
                value={data.activeGroups}
                icon={<UsersRound className={iconClass} aria-hidden="true" />}
                hint={`${plural(groups.length, 'groupe')} suivis au total`}
              />
              <StatCard
                label="Collecté ce mois"
                value={formatAmount(data.collectedThisMonth)}
                icon={<Coins className={iconClass} aria-hidden="true" />}
                hint={`sur ${formatAmount(data.expectedThisMonth)} attendus`}
              />
              <StatCard
                label="Membres dans mes groupes actifs"
                value={data.memberCount}
                icon={<Users className={iconClass} aria-hidden="true" />}
                hint={`${plural(data.activeGroups, 'groupe actif')}`}
              />
              <StatCard
                label="Membres en retard"
                value={data.lateMembers}
                icon={<AlertTriangle className={iconClass} aria-hidden="true" />}
                hint={
                  data.lateAmount > 0
                    ? `${formatAmount(data.lateAmount)} à recouvrer`
                    : 'Personne en retard'
                }
                hintTone={data.lateAmount > 0 ? 'warning' : 'positive'}
              />
            </section>

            <TodoCard items={data.todo} />

            {next ? (
              <section className="flex flex-col gap-3 rounded-card bg-blue-700 p-5 text-white shadow-card sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <CalendarClock className="h-6 w-6 shrink-0 text-blue-100" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-label text-blue-100">Prochain versement</p>
                    <p className="mt-1 truncate font-display text-section">
                      {next.beneficiaryName}
                    </p>
                    <p className="text-label text-blue-100">
                      {next.groupName} · prévu le {formatDate(next.date)}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/admin/groupes/${next.groupId}`}
                  className="min-h-touch shrink-0 rounded-control bg-white px-4 font-bold text-blue-700 transition-colors hover:bg-blue-100"
                >
                  Ouvrir le groupe
                </Link>
              </section>
            ) : null}

            {groups.length === 0 || !selected ? (
              <EmptyState
                title="Aucun groupe pour l’instant"
                description="Créez votre première tontine et invitez les participants."
                action={
                  <Link to="/admin/groupes/nouveau" className={headerLinkClass.blue}>
                    Créer un groupe
                  </Link>
                }
              />
            ) : (
              <>
                {/* Vue d'ensemble de chaque groupe : statut et collecte du tour courant. */}
                <div
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  role="group"
                  aria-label="Vue d’ensemble de mes groupes"
                >
                  {groups.map((overview) => {
                    const { group } = overview;
                    const active = group.id === selected.group.id;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedId(group.id)}
                        className={cn(
                          'flex min-h-[112px] flex-col items-stretch gap-2 rounded-card border p-4 text-left transition-colors duration-150',
                          active
                            ? 'border-blue-700 bg-blue-100 ring-2 ring-blue-700/10'
                            : 'border-line bg-white hover:border-blue-700',
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate font-bold text-ink">{group.name}</span>
                          <GroupStatusBadge status={group.status} />
                        </span>
                        <span className="text-small text-muted">
                          {plural(overview.activeMemberCount, 'personne')} · {overview.activeShareCount}{' '}
                          parts
                          {group.status !== 'draft' ? ` · Cycle ${group.currentCycle}` : ''}
                        </span>
                        {overview.currentRound ? (
                          <span className="text-small font-semibold text-blue-900">
                            Tour {overview.currentRound.number} · {overview.paidCount}/
                            {overview.activeShareCount} parts payées
                          </span>
                        ) : (
                          <span className="text-small text-muted">
                            {group.status === 'draft'
                              ? 'En attente de démarrage'
                              : 'Aucun tour en cours'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <GroupWorkspace overview={selected} />
              </>
            )}
          </div>
        );
      }}
    </AsyncContent>
  );
}
