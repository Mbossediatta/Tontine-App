import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarCheck, Coins, Plus, Users, UsersRound } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, PageSkeleton } from '@/components/ui';
import { formatAmount, formatMonth, plural } from '@/lib/format';
import { AccountFormDialog } from '../components/AccountFormDialog';
import { CollectionChart } from '../components/CollectionChart';
import { DashboardHeader } from '../components/DashboardHeader';
import { StatCard } from '../components/StatCard';
import { useSuperDashboard } from '../queries';
import { env } from '@/lib/env';
import { AdminsCard } from './AdminsCard';
import { AlertsCard } from './AlertsCard';
import { AuditCard } from './AuditCard';
import { TransactionsCard } from './TransactionsCard';

/** « novembre 2026 » → « Novembre 2026 ». */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const iconClass = 'h-5 w-5';

/**
 * Tableau de bord du super administrateur (vue globale de la plateforme) :
 *
 * 1. Quatre indicateurs : groupes, membres et admins, collecte du mois, ponctualité.
 * 2. Collectes mensuelles (attendu / collecté) à côté des alertes à traiter
 *    (sur téléphone, les alertes passent en premier : c'est ce qu'on y vient voir).
 * 3. Les administrateurs et leur taux de recouvrement.
 * 4. Activité récente : dernières transactions et dernières actions (journal d'audit).
 *
 * La liste complète des groupes est dans la rubrique « Groupes ».
 */
export function SuperAdminDashboard() {
  const query = useSuperDashboard();
  const [addOpen, setAddOpen] = useState(false);
  const now = new Date();
  const month = capitalize(formatMonth(now)); // « Novembre 2026 »
  const monthName = format(now, 'MMMM', { locale: fr }); // « novembre »

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        title="Tableau de bord Superadmin"
        showBell={false}
        subtitle={`Vue globale de la plateforme · ${month}`}
        actions={
          <OnlineButton
            variant="blue"
            size="sm"
            onClick={() => setAddOpen(true)}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Nouvel admin
          </OnlineButton>
        }
      />

      <AsyncContent query={query} skeleton={<PageSkeleton />}>
        {(data) => (
          <>
            {/* 1. Indicateurs */}
            {/* 1 colonne sous 360 px, 2 sur téléphone, 4 sur ordinateur. */}
            <section
              className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4"
              aria-label="Indicateurs"
            >
              <StatCard
                label="Groupes actifs"
                value={data.groups.active}
                icon={<UsersRound className={iconClass} aria-hidden="true" />}
                hint={`${plural(data.groups.suspended, 'suspendu')} · ${plural(data.groups.finished, 'terminé')}`}
              />
              <StatCard
                label="Membres inscrits"
                value={data.members}
                icon={<Users className={iconClass} aria-hidden="true" />}
                hint={`+${data.newMembersThisMonth} ce mois · ${plural(data.admins.length, 'admin')}`}
                hintTone={data.newMembersThisMonth > 0 ? 'positive' : 'muted'}
              />
              <StatCard
                label={`Collecté en ${monthName}`}
                value={formatAmount(data.collectedThisMonth)}
                icon={<Coins className={iconClass} aria-hidden="true" />}
                hint={`sur ${formatAmount(data.expectedThisMonth)} attendus`}
              />
              <StatCard
                label="Paiements à temps"
                // « — » tant qu'aucune cotisation n'est échue (pas de 0 % trompeur).
                value={data.onTimeRate === null ? '—' : `${data.onTimeRate} %`}
                icon={<CalendarCheck className={iconClass} aria-hidden="true" />}
                hint={
                  data.lateAmount > 0
                    ? `${formatAmount(data.lateAmount)} en retard`
                    : 'Aucun retard en cours'
                }
                hintTone={data.lateAmount > 0 ? 'warning' : 'positive'}
              />
            </section>

            {/* 2. Collectes mensuelles et alertes */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)] lg:items-start">
              {/* Alertes d'abord dans le code : sur téléphone, elles passent avant le graphique. */}
              <div className="lg:col-start-2 lg:row-start-1">
                <AlertsCard alerts={data.alerts} linksEnabled={!env.realAuth} />
              </div>
              <div className="lg:col-start-1 lg:row-start-1">
                <CollectionChart data={data.monthly} />
              </div>
            </div>

            {/* 3. Administrateurs */}
            <AdminsCard admins={data.admins} readOnly={env.realAuth} />

            {/* 4. Transactions et journal d'audit */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
              <TransactionsCard transactions={data.transactions} />
              <AuditCard entries={data.audit} />
            </div>
          </>
        )}
      </AsyncContent>

      <AccountFormDialog kind="admin" open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
