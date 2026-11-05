import { isSameMonth, isToday, startOfMonth, subMonths } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { fullName, plural } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type {
  AccountInput,
  AdminChoice,
  AdminDashboard,
  AdminPerformance,
  AuditEntry,
  Community,
  GroupStatus,
  MonthlyCollection,
  Payment,
  PaymentMethod,
  PaymentStatus,
  SaveCommunityInput,
  SuperAdminDashboard,
  TodoItem,
  TransactionRow,
  User,
} from '@/types';
import type { AdminService } from '../admin.service';
import { groupRows } from './group.supabase';
import {
  activeMemberships,
  buildOverview,
  canManage,
  currentRoundOf,
  lateEntries,
  loadContext,
  memberStatus,
  roundCollected,
  roundExpected,
} from './groupData';
import { invoke, rpc } from './rpc';

const PAGE_SIZE = 1000;

interface QueryError {
  code?: string;
  message: string;
}

interface PageResult<Row> {
  data: Row[] | null;
  error: QueryError | null;
}

type PageQuery<Row> = (from: number, to: number) => PromiseLike<PageResult<Row>>;

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  global_role: User['globalRole'];
  is_suspended: boolean;
  payout_phone: string | null;
  payout_method: User['payoutMethod'] | null;
  deleted_at: string | null;
  created_at: string;
}

interface GroupRow {
  id: string;
  name: string;
  status: GroupStatus;
  contribution_amount: number;
  turn_length: number;
  membership_fee_amount: number;
  late_penalty: number | null;
  admin_id: string;
}

interface MembershipRow {
  id: string;
  group_id: string;
  user_id: string;
  role: 'owner' | 'co_admin' | 'member';
  status: 'pending' | 'active' | 'removed';
}

interface RoundRow {
  id: string;
  group_id: string;
  number: number;
  due_date: string;
  status: 'upcoming' | 'open' | 'ready_for_payout' | 'paid_out';
}

interface PaymentRow {
  id: string;
  round_id: string;
  user_id: string;
  amount: number;
  contribution_amount: number;
  membership_fee_amount: number;
  late_penalty_amount: number;
  service_fee_amount: number;
  method: PaymentMethod;
  provider_ref: string | null;
  status: PaymentStatus;
  paid_at: string | null;
  created_at: string;
}

interface PenaltyRow {
  id: string;
  round_id: string;
  user_id: string;
  amount: number;
}

interface EarningRow {
  id: string;
  group_id: string;
  user_id: string | null;
  kind: string;
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: AuditEntry['action'];
  summary: string;
  group_id: string | null;
  at: string;
}

interface CommunityRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  community_admins: { admin_id: string }[];
}

interface PinPendingRow {
  user_id: string;
  pin_pending: boolean;
}

function requireOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ServiceError('Connexion requise pour consulter le tableau de bord.', 'offline');
  }
}

function throwQueryError(error: QueryError): never {
  if (error.code === '42501') {
    throw new ServiceError('Accès réservé au super administrateur.', 'forbidden');
  }
  if (error.code === 'PGRST301' || error.code === 'JWT expired') {
    throw new ServiceError('Session expirée, reconnectez-vous.', 'unauthenticated');
  }
  throw new ServiceError('Impossible de charger le tableau de bord. Réessayez.');
}

async function readAll<Row>(queryPage: PageQuery<Row>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) throwQueryError(error);
    if (!data) return rows;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone ?? '',
    avatarUrl: row.avatar_url ?? undefined,
    globalRole: row.global_role,
    isSuspended: row.is_suspended,
    payoutPhone: row.payout_phone ?? undefined,
    payoutMethod: row.payout_method ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
  };
}

function toCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    adminIds: row.community_admins.map(({ admin_id }) => admin_id),
    createdAt: row.created_at,
  };
}

const COMMUNITY_COLUMNS = 'id, name, description, created_at, community_admins (admin_id)';

function toPublicUser(user: User) {
  if (user.deletedAt) {
    return { id: user.id, firstName: 'Compte', lastName: 'supprimé' };
  }
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    payoutPhone: user.payoutPhone,
    payoutMethod: user.payoutMethod,
  };
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    roundId: row.round_id,
    userId: row.user_id,
    amount: row.amount,
    contributionAmount: row.contribution_amount,
    membershipFeeAmount: row.membership_fee_amount,
    latePenaltyAmount: row.late_penalty_amount,
    serviceFeeAmount: row.service_fee_amount,
    method: row.method,
    providerRef: row.provider_ref ?? undefined,
    status: row.status,
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  };
}

function transactionDate(payment: PaymentRow): number {
  return new Date(payment.created_at || payment.paid_at || 0).getTime();
}

export function createSupabaseAdminService(): AdminService {
  async function createAdmin(input: AccountInput): Promise<void> {
    await invoke(
      'admin-create',
      { firstName: input.firstName, lastName: input.lastName, phone: input.phone },
      'Impossible de créer l’administrateur. Vérifiez la connexion et réessayez.',
    );
  }

  async function readCommunities(ids?: string[]): Promise<Community[]> {
    let query = supabase().from('communities').select(COMMUNITY_COLUMNS).order('name');
    if (ids) query = query.in('id', ids);
    const { data, error } = await query;
    if (error) throwQueryError(error);
    return ((data ?? []) as CommunityRow[]).map(toCommunity);
  }

  async function listCommunities(): Promise<Community[]> {
    requireOnline();
    const [communities, { data: session }] = await Promise.all([
      readCommunities(),
      supabase().auth.getSession(),
    ]);
    const userId = session.session?.user.id ?? '';
    const { data: me } = await supabase()
      .from('profiles')
      .select('global_role')
      .eq('id', userId)
      .maybeSingle();
    if (me?.global_role === 'super_admin') return communities;
    // Comme la simulation : un admin ne voit que les communautés qui lui sont affectées
    // (la base lui montre aussi celles où il gère ou suit un groupe).
    return communities.filter((community) => community.adminIds.includes(userId));
  }

  async function saveCommunity(input: SaveCommunityInput): Promise<Community> {
    requireOnline();
    const id = await rpc<string>(
      'community_save',
      {
        p_id: input.id ?? null,
        p_name: input.name,
        p_description: input.description ?? null,
        p_admin_ids: input.adminIds,
      },
      'Enregistrement impossible. Vérifiez la connexion et réessayez.',
    );
    const [community] = await readCommunities([id]);
    if (!community) throw new ServiceError('Cette communauté est introuvable.', 'not_found');
    return community;
  }

  async function loadDashboard(): Promise<{
    data: SuperAdminDashboard;
    transactions: TransactionRow[];
  }> {
    requireOnline();
    const client = supabase();

    const [
      profileRows,
      groups,
      memberships,
      rounds,
      payments,
      penalties,
      earnings,
      auditRows,
      settingsResult,
    ] = await Promise.all([
      readAll<ProfileRow>((from, to) =>
        client
          .from('profiles')
          .select(
            'id, first_name, last_name, phone, avatar_url, global_role, is_suspended, payout_phone, payout_method, deleted_at, created_at',
          )
          .order('id')
          .range(from, to),
      ),
      readAll<GroupRow>((from, to) =>
        client
          .from('groups')
          .select(
            'id, name, status, contribution_amount, turn_length, membership_fee_amount, late_penalty, admin_id',
          )
          .order('id')
          .range(from, to),
      ),
      readAll<MembershipRow>((from, to) =>
        client
          .from('memberships')
          .select('id, group_id, user_id, role, status')
          .order('id')
          .range(from, to),
      ),
      readAll<RoundRow>((from, to) =>
        client
          .from('rounds')
          .select('id, group_id, number, due_date, status')
          .order('id')
          .range(from, to),
      ),
      readAll<PaymentRow>((from, to) =>
        client
          .from('payments')
          .select(
            'id, round_id, user_id, amount, contribution_amount, membership_fee_amount, late_penalty_amount, service_fee_amount, method, provider_ref, status, paid_at, created_at',
          )
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
      readAll<PenaltyRow>((from, to) =>
        client
          .from('penalties')
          .select('id, round_id, user_id, amount')
          .order('id')
          .range(from, to),
      ),
      readAll<EarningRow>((from, to) =>
        client
          .from('platform_earnings')
          .select('id, group_id, user_id, kind')
          .order('id')
          .range(from, to),
      ),
      client
        .from('audit_log')
        .select('id, actor_id, action, summary, group_id, at')
        .order('at', { ascending: false })
        .limit(5),
      client.rpc('public_settings'),
    ]);

    if (auditRows.error) throwQueryError(auditRows.error);
    if (settingsResult.error) throwQueryError(settingsResult.error);

    const profiles = profileRows;
    const users = new Map(profiles.map((row) => [row.id, toUser(row)]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const roundById = new Map(rounds.map((round) => [round.id, round]));
    const activeMemberships = memberships.filter((membership) => membership.status === 'active');
    const earningsByGroupUser = new Set(
      earnings
        .filter((earning) => earning.kind === 'membership_fee' && earning.user_id)
        .map((earning) => `${earning.group_id}:${earning.user_id}`),
    );
    const paymentsByRoundUser = new Map<string, PaymentRow[]>();
    const paymentsByRound = new Map<string, PaymentRow[]>();
    for (const payment of payments) {
      const key = `${payment.round_id}:${payment.user_id}`;
      const entries = paymentsByRoundUser.get(key) ?? [];
      entries.push(payment);
      paymentsByRoundUser.set(key, entries);
      const roundPayments = paymentsByRound.get(payment.round_id) ?? [];
      roundPayments.push(payment);
      paymentsByRound.set(payment.round_id, roundPayments);
    }
    const penaltiesByRound = new Map<string, PenaltyRow[]>();
    for (const penalty of penalties) {
      const entries = penaltiesByRound.get(penalty.round_id) ?? [];
      entries.push(penalty);
      penaltiesByRound.set(penalty.round_id, entries);
    }
    const membershipsByGroup = new Map<string, MembershipRow[]>();
    const membershipCountsByGroupUser = new Map<string, number>();
    for (const membership of activeMemberships) {
      const entries = membershipsByGroup.get(membership.group_id) ?? [];
      entries.push(membership);
      membershipsByGroup.set(membership.group_id, entries);
      const key = `${membership.group_id}:${membership.user_id}`;
      membershipCountsByGroupUser.set(key, (membershipCountsByGroupUser.get(key) ?? 0) + 1);
    }

    const expectedForRound = (round: RoundRow): number => {
      if (round.status === 'upcoming') return 0;
      const group = groupById.get(round.group_id);
      if (!group) return 0;
      const groupMemberships = membershipsByGroup.get(group.id) ?? [];
      const contributions = group.contribution_amount * group.turn_length * groupMemberships.length;
      const usersWithShares = new Set(groupMemberships.map((membership) => membership.user_id));
      const unpaidFees = [...usersWithShares].filter(
        (userId) => !earningsByGroupUser.has(`${group.id}:${userId}`),
      ).length;
      const penaltyTotal = (penaltiesByRound.get(round.id) ?? []).reduce(
        (sum, penalty) => sum + penalty.amount,
        0,
      );
      return contributions + unpaidFees * group.membership_fee_amount + penaltyTotal;
    };

    const collectedForRound = (round: RoundRow): number =>
      (paymentsByRound.get(round.id) ?? [])
        .filter((payment) => payment.status === 'paid')
        .reduce((sum, payment) => sum + payment.amount, 0);

    const now = new Date();
    const monthly: MonthlyCollection[] = Array.from({ length: 6 }, (_, index) => {
      const month = startOfMonth(subMonths(now, 5 - index));
      const monthRounds = rounds.filter((round) => isSameMonth(new Date(round.due_date), month));
      return {
        month: month.toISOString(),
        expected: monthRounds.reduce((sum, round) => sum + expectedForRound(round), 0),
        collected: monthRounds.reduce((sum, round) => sum + collectedForRound(round), 0),
      };
    });

    const activeProfiles = profiles.filter((profile) => !profile.deleted_at);
    const admins = activeProfiles
      .filter((profile) => profile.global_role === 'admin')
      .map((profile) => toUser(profile));
    const adminPinRows: PinPendingRow[] = admins.length
      ? await (async () => {
          const { data, error } = await client.rpc('admin_pin_pending', {
            p_users: admins.map((admin) => admin.id),
          });
          if (error) throwQueryError(error);
          return data as PinPendingRow[];
        })()
      : [];
    const pinPendingById = new Map(adminPinRows.map((row) => [row.user_id, row.pin_pending]));
    const managedGroupIdsByAdmin = new Map<string, Set<string>>();
    for (const group of groups) {
      const managedGroupIds = managedGroupIdsByAdmin.get(group.admin_id) ?? new Set<string>();
      managedGroupIds.add(group.id);
      managedGroupIdsByAdmin.set(group.admin_id, managedGroupIds);
    }
    for (const membership of activeMemberships) {
      if (membership.role !== 'owner' && membership.role !== 'co_admin') continue;
      const managedGroupIds = managedGroupIdsByAdmin.get(membership.user_id) ?? new Set<string>();
      managedGroupIds.add(membership.group_id);
      managedGroupIdsByAdmin.set(membership.user_id, managedGroupIds);
    }

    const adminPerformance: AdminPerformance[] = admins.map((admin) => {
      const managedGroupIds = managedGroupIdsByAdmin.get(admin.id) ?? new Set<string>();
      const managedGroups = groups.filter((group) => managedGroupIds.has(group.id));
      const groupIds = new Set(managedGroups.map((group) => group.id));
      const memberIds = new Set(
        activeMemberships
          .filter((membership) => groupIds.has(membership.group_id))
          .map((membership) => membership.user_id),
      );
      memberIds.delete(admin.id);
      const dueRounds = rounds.filter(
        (round) =>
          groupIds.has(round.group_id) &&
          round.status !== 'upcoming' &&
          new Date(round.due_date) < now,
      );
      const expected = dueRounds.reduce((sum, round) => sum + expectedForRound(round), 0);
      const collected = dueRounds.reduce((sum, round) => sum + collectedForRound(round), 0);

      return {
        user: admin,
        groups: managedGroups.map(({ id, name, status }) => ({ id, name, status })),
        memberCount: memberIds.size,
        recoveryRate: expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null,
        pinPending: pinPendingById.get(admin.id) ?? true,
      };
    });

    const alerts: SuperAdminDashboard['alerts'] = [];
    const failedToday = payments.filter(
      (payment) => payment.status === 'failed' && isToday(new Date(payment.created_at)),
    ).length;
    if (failedToday > 0) {
      alerts.push({
        id: 'failed-today',
        tone: 'danger',
        title: `${plural(failedToday, 'paiement échoué', 'paiements échoués')} aujourd’hui`,
        detail: 'Vérifier avec le service de paiement',
      });
    }

    const settings = settingsResult.data as { rules?: { graceDays?: number } } | null;
    const graceDays = settings?.rules?.graceDays ?? 0;
    let lateAmount = 0;
    for (const group of groups.filter((item) => item.status === 'active')) {
      const round = rounds.find(
        (item) =>
          item.group_id === group.id &&
          (item.status === 'open' || item.status === 'ready_for_payout'),
      );
      if (!round) continue;

      const lateMembers = [
        ...new Set(
          (membershipsByGroup.get(group.id) ?? []).map((membership) => membership.user_id),
        ),
      ].filter((userId) => {
        const memberPayments = paymentsByRoundUser.get(`${round.id}:${userId}`) ?? [];
        const hasPaid = memberPayments.some((payment) => payment.status === 'paid');
        const hasPenalty = (penaltiesByRound.get(round.id) ?? []).some(
          (penalty) => penalty.user_id === userId,
        );
        const lateAfter = new Date(round.due_date);
        lateAfter.setDate(lateAfter.getDate() + graceDays);
        return !hasPaid && (hasPenalty || lateAfter < now);
      });

      for (const userId of lateMembers) {
        const memberShareCount = membershipCountsByGroupUser.get(`${group.id}:${userId}`) ?? 0;
        const memberPenalty = (penaltiesByRound.get(round.id) ?? [])
          .filter((penalty) => penalty.user_id === userId)
          .reduce((sum, penalty) => sum + penalty.amount, 0);
        const membershipFee = earningsByGroupUser.has(`${group.id}:${userId}`)
          ? 0
          : group.membership_fee_amount;
        lateAmount +=
          group.contribution_amount * group.turn_length * memberShareCount +
          memberPenalty +
          membershipFee;
      }

      if (lateMembers.length > 0) {
        const groupAdmin = users.get(group.admin_id);
        alerts.push({
          id: `late-${group.id}`,
          tone: 'warning',
          title: `${group.name} : ${plural(lateMembers.length, 'membre')} en retard`,
          detail: `Admin : ${groupAdmin ? fullName(groupAdmin) : '—'}`,
          link: `/admin/groupes/${group.id}`,
        });
      }
    }

    for (const group of groups) {
      const requestCount = memberships.filter(
        (membership) => membership.group_id === group.id && membership.status === 'pending',
      ).length;
      if (requestCount === 0) continue;
      const groupAdmin = users.get(group.admin_id);
      alerts.push({
        id: `join-${group.id}`,
        tone: 'info',
        title: `${plural(requestCount, 'demande', 'demandes')} d’adhésion en attente`,
        detail: `${group.name} · Admin : ${groupAdmin ? fullName(groupAdmin) : '—'}`,
        link: `/admin/groupes/${group.id}`,
      });
    }

    let dueCount = 0;
    let onTimeCount = 0;
    for (const round of rounds) {
      if (round.status === 'upcoming') continue;
      const dueDate = new Date(round.due_date);
      for (const { user_id: userId } of membershipsByGroup.get(round.group_id) ?? []) {
        const successfulPayment = (paymentsByRoundUser.get(`${round.id}:${userId}`) ?? []).find(
          (payment) => payment.status === 'paid',
        );
        if (successfulPayment) {
          dueCount += 1;
          if (!successfulPayment.paid_at || new Date(successfulPayment.paid_at) <= dueDate) {
            onTimeCount += 1;
          }
        } else if (dueDate < now) {
          dueCount += 1;
        }
      }
    }

    const allTransactions = [...payments]
      .sort((left, right) => transactionDate(right) - transactionDate(left))
      .flatMap((payment): TransactionRow[] => {
        const round = roundById.get(payment.round_id);
        const group = round ? groupById.get(round.group_id) : undefined;
        const user = users.get(payment.user_id);
        if (!round || !group || !user) return [];
        return [
          {
            payment: toPayment(payment),
            user: toPublicUser(user),
            groupId: group.id,
            groupName: group.name,
            roundNumber: round.number,
          },
        ];
      });

    const recentAudit = ((auditRows.data ?? []) as AuditRow[]).map((entry) => {
      const actor = entry.actor_id ? users.get(entry.actor_id) : undefined;
      return {
        entry: {
          id: entry.id,
          actorId: entry.actor_id ?? '',
          action: entry.action,
          summary: entry.summary,
          groupId: entry.group_id ?? undefined,
          at: entry.at,
        },
        actorName: actor && !actor.deletedAt ? fullName(actor) : 'Compte supprimé',
      };
    });
    const countGroups = (status: GroupStatus) =>
      groups.filter((group) => group.status === status).length;
    const members = activeProfiles.filter((profile) => profile.global_role === 'user');
    const thisMonth = monthly[monthly.length - 1];

    return {
      data: {
        groups: {
          total: groups.length,
          active: countGroups('active'),
          suspended: countGroups('suspended'),
          finished: countGroups('finished'),
          draft: countGroups('draft'),
        },
        members: members.length,
        newMembersThisMonth: members.filter((profile) =>
          isSameMonth(new Date(profile.created_at), now),
        ).length,
        collectedThisMonth: thisMonth?.collected ?? 0,
        expectedThisMonth: thisMonth?.expected ?? 0,
        onTimeRate: dueCount > 0 ? Math.round((onTimeCount / dueCount) * 100) : null,
        lateAmount,
        monthly,
        alerts,
        admins: adminPerformance,
        transactions: allTransactions.slice(0, 5),
        audit: recentAudit,
      },
      transactions: allTransactions,
    };
  }

  return {
    async superDashboard() {
      return (await loadDashboard()).data;
    },
    async listTransactions() {
      return (await loadDashboard()).transactions;
    },
    async listAdmins() {
      return (await loadDashboard()).data.admins;
    },
    async getAdmin(userId) {
      const admin = (await loadDashboard()).data.admins.find(({ user }) => user.id === userId);
      if (!admin) throw new ServiceError('Administrateur introuvable.', 'not_found');
      return admin;
    },
    createAdmin,
    listCommunities,
    saveCommunity,
    dashboard,
    async updateAdmin(userId, input) {
      requireOnline();
      await rpc('admin_update', {
        p_user: userId,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_phone: input.phone,
      });
    },
    async suspend(userId) {
      requireOnline();
      await rpc('admin_suspend', { p_user: userId });
    },
    async reactivate(userId) {
      requireOnline();
      await rpc('admin_reactivate', { p_user: userId });
    },
    async deleteAdmin(userId) {
      requireOnline();
      await rpc('admin_revoke', { p_user: userId });
    },
    async reassignGroups(fromId, toId) {
      requireOnline();
      return rpc<number>('admin_reassign_groups', { p_from: fromId, p_to: toId });
    },
    async listAdminChoices() {
      return rpc<AdminChoice[]>('admin_choices');
    },
    async suspendGroup(groupId) {
      requireOnline();
      await rpc('group_suspend', { p_group: groupId });
    },
    async reactivateGroup(groupId) {
      requireOnline();
      await rpc('group_reactivate', { p_group: groupId });
    },
    async closeGroup(groupId) {
      requireOnline();
      await rpc('group_close', { p_group: groupId });
    },
    async archiveGroup(groupId) {
      requireOnline();
      await rpc('group_archive', { p_group: groupId });
    },
    async changeGroupAdmin(groupId, adminId) {
      requireOnline();
      await rpc('group_change_admin', { p_group: groupId, p_admin: adminId });
    },
    async transferGroup(groupId, communityId, adminId) {
      requireOnline();
      await rpc('group_transfer', {
        p_group: groupId,
        p_community: communityId,
        p_admin: adminId,
      });
    },
  };
}

/**
 * Tableau de bord d'un administrateur : ses groupes (non archivés), l'encaissé et
 * l'attendu du mois, les retards, le prochain versement et les tâches à traiter
 * (mêmes calculs que services/mock/admin.mock.ts et metrics.ts).
 */
async function dashboard(): Promise<AdminDashboard> {
  const ctx = await loadContext(await groupRows());
  const groups = ctx.groups.filter((group) => canManage(ctx, group) && !group.archivedAt);
  const active = groups.filter((group) => group.status === 'active');
  const name = (userId: string) => {
    const person = ctx.people.get(userId);
    return person ? `${person.firstName} ${person.lastName}` : 'Un membre';
  };
  const now = new Date();

  // Attendu / encaissé sur les tours dont l'échéance tombe ce mois-ci.
  const monthRounds = ctx.rounds.filter(
    (round) =>
      active.some((group) => group.id === round.groupId) &&
      isSameMonth(new Date(round.dueDate), now),
  );
  const expectedThisMonth = monthRounds.reduce((sum, round) => sum + roundExpected(ctx, round), 0);
  const collectedThisMonth = monthRounds.reduce(
    (sum, round) => sum + roundCollected(ctx, round),
    0,
  );

  // Retards et prochain versement (tour en cours de chaque groupe actif).
  const lates = lateEntries(ctx).filter((late) => active.some((g) => g.id === late.groupId));
  let nextPayout: AdminDashboard['nextPayout'];
  for (const group of active) {
    const round = currentRoundOf(ctx, group);
    if (!round) continue;
    if (!nextPayout || new Date(round.dueDate) < new Date(nextPayout.date)) {
      const beneficiaryIds = activeMemberships(ctx, group.id)
        .filter((item) => round.beneficiaryMembershipIds?.includes(item.id))
        .map((item) => item.userId);
      nextPayout = {
        date: round.dueDate,
        groupId: group.id,
        groupName: group.name,
        beneficiaryName:
          round.recipientType === 'platform'
            ? 'Période réservée à la plateforme'
            : [...new Set(beneficiaryIds)].map(name).join(', ') || '—',
      };
    }
  }

  const todo: TodoItem[] = [];
  for (const group of groups) {
    const base = { groupId: group.id, groupName: group.name };
    for (const pending of ctx.memberships.filter(
      (item) => item.groupId === group.id && item.status === 'pending',
    )) {
      todo.push({
        ...base,
        id: `join-${pending.id}`,
        kind: 'join_request',
        label: `${name(pending.userId)} demande à rejoindre`,
      });
    }
    const round = currentRoundOf(ctx, group);
    if (!round) continue;
    if (round.status === 'ready_for_payout') {
      todo.push({
        ...base,
        id: `payout-${round.id}`,
        kind: 'ready_for_payout',
        label: `Tour ${round.number} prêt pour le reversement`,
      });
    }
    for (const userId of new Set(activeMemberships(ctx, group.id).map((item) => item.userId))) {
      if (memberStatus(ctx, round, userId) === 'failed') {
        todo.push({
          ...base,
          id: `failed-${round.id}-${userId}`,
          kind: 'failed_payment',
          label: `Paiement échoué : ${name(userId)}`,
        });
      }
    }
  }
  return {
    activeGroups: active.length,
    memberCount: active.reduce(
      (sum, group) =>
        sum +
        new Set(
          ctx.memberships
            .filter((item) => item.groupId === group.id && item.status === 'active')
            .map((item) => item.userId),
        ).size,
      0,
    ),
    collectedThisMonth,
    expectedThisMonth,
    lateMembers: lates.length,
    lateAmount: lates.reduce((sum, late) => sum + late.amount, 0),
    nextPayout,
    todo,
    groups: groups.map((group) => buildOverview(ctx, group)),
  };
}
