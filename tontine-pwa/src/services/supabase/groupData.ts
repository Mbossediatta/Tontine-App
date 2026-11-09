// Lecture des groupes dans la base (tables filtrées par RLS) et construction des vues
// GroupOverview et MemberView, avec les mêmes calculs que services/mock/views.ts.
import { supabase } from '@/lib/supabase';
import { computePot, contributionPerTurn, personPayout, serviceFee } from '@/lib/tontine';
import type {
  Group,
  GroupOverview,
  GroupRole,
  MemberView,
  Membership,
  MembershipStatus,
  Payment,
  PaymentStatus,
  PublicUser,
  Round,
  TransactionRow,
  PayoutMethod,
  PayoutTransfer,
} from '@/types';
import { rows, rpc, sessionUserId } from './rpc';

// --- Lignes de la base ---------------------------------------------------------

export interface GroupRow {
  id: string;
  community_id: string | null;
  join_policy: 'invite' | 'community';
  name: string;
  description: string | null;
  contribution_amount: number;
  turn_length: number;
  shares_per_round: number;
  membership_fee_amount: number;
  reserve_final_turn: boolean;
  frequency: Group['frequency'];
  max_members: number;
  payment_due_day: number;
  payment_due_time: string;
  start_date: string;
  attribution_mode: Group['attributionMode'];
  late_penalty: number | null;
  status: Group['status'];
  invite_code: string;
  created_by: string;
  admin_id: string;
  member_status_visibility: 'members' | 'admins';
  current_cycle: number;
  archived_at: string | null;
}

interface MembershipRow {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  status: MembershipStatus;
  payout_order: number | null;
  joined_at: string;
}

interface RoundRow {
  id: string;
  group_id: string;
  cycle: number;
  number: number;
  open_date: string;
  due_date: string;
  recipient_type: 'members' | 'platform';
  pot_amount: number;
  status: Round['status'];
  paid_out_at: string | null;
  payout_validated_by: string | null;
  payout_blocked_at: string | null;
  payout_block_reason: string | null;
  payout_requested_at: string | null;
  round_beneficiaries: {
    membership_id: string;
    amount: number;
    sent_at: string | null;
    sent_method: PayoutMethod | null;
    sent_ref: string | null;
    received_at: string | null;
  }[];
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
  method: Payment['method'];
  status: PaymentStatus;
  provider_ref: string | null;
  paid_at: string | null;
  created_at: string;
}

interface PenaltyRow {
  round_id: string;
  user_id: string;
  amount: number;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone?: string | null;
  payout_phone?: string | null;
  payout_method?: PublicUser['payoutMethod'] | null;
  deleted_at?: string | null;
}

export const GROUP_COLUMNS =
  'id, community_id, join_policy, name, description, contribution_amount, turn_length, shares_per_round, membership_fee_amount, reserve_final_turn, frequency, max_members, payment_due_day, payment_due_time, start_date, attribution_mode, late_penalty, status, invite_code, created_by, admin_id, member_status_visibility, current_cycle, archived_at';

export function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    communityId: row.community_id ?? undefined,
    joinPolicy: row.join_policy,
    name: row.name,
    description: row.description ?? undefined,
    contributionAmount: row.contribution_amount,
    turnLength: row.turn_length,
    sharesPerRound: row.shares_per_round,
    membershipFeeAmount: row.membership_fee_amount,
    reserveFinalTurn: row.reserve_final_turn,
    frequency: row.frequency,
    maxMembers: row.max_members,
    paymentDueDay: row.payment_due_day,
    paymentDueTime: row.payment_due_time?.slice(0, 5),
    startDate: new Date(`${row.start_date.slice(0, 10)}T00:00:00Z`).toISOString(),
    attributionMode: row.attribution_mode,
    latePenalty: row.late_penalty ?? undefined,
    status: row.status,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    adminId: row.admin_id,
    archivedAt: row.archived_at ?? undefined,
    memberStatusVisibility: row.member_status_visibility,
    currentCycle: row.current_cycle,
  };
}

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    payoutOrder: row.payout_order ?? undefined,
    joinedAt: row.joined_at,
  };
}

function toRound(row: RoundRow, memberships: Membership[]): Round {
  const beneficiaryIds = row.round_beneficiaries.map((item) => item.membership_id);
  const first = memberships.find((item) => item.id === beneficiaryIds[0]);
  // Montant reçu par personne (somme de ses parts bénéficiaires), comme dans la simulation.
  const amounts = new Map<string, number>();
  const transfers: Record<string, PayoutTransfer> = {};
  for (const item of row.round_beneficiaries) {
    const userId = memberships.find((membership) => membership.id === item.membership_id)?.userId;
    if (userId) amounts.set(userId, (amounts.get(userId) ?? 0) + item.amount);
    // Envoi réel de la cagnotte (le même pour toutes les parts d'une personne).
    if (userId && item.sent_at && item.sent_method && item.sent_ref) {
      transfers[userId] = {
        sentAt: item.sent_at,
        method: item.sent_method,
        ref: item.sent_ref,
        receivedAt: item.received_at ?? undefined,
      };
    }
  }
  return {
    id: row.id,
    groupId: row.group_id,
    number: row.number,
    openDate: row.open_date,
    dueDate: row.due_date,
    beneficiaryId: first?.userId ?? '',
    beneficiaryMembershipIds: beneficiaryIds,
    recipientType: row.recipient_type,
    beneficiaryAmounts: Object.fromEntries(amounts),
    potAmount: row.pot_amount,
    status: row.status,
    paidOutAt: row.paid_out_at ?? undefined,
    payoutValidatedBy: row.payout_validated_by ?? undefined,
    payoutBlockedAt: row.payout_blocked_at ?? undefined,
    payoutBlockReason: row.payout_block_reason ?? undefined,
    payoutRequestedAt: row.payout_requested_at ?? undefined,
    transfers,
    cycle: row.cycle,
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

// --- Contexte de lecture ---------------------------------------------------------

export interface Viewer {
  id: string;
  role: 'super_admin' | 'admin' | 'user';
}

let knownViewer: Promise<Viewer> | null = null;
let knownViewerId = '';

/** Personne connectée et son rôle ; le rôle est lu une fois par compte (un aller-retour de moins). */
export async function currentViewer(): Promise<Viewer> {
  const id = await sessionUserId();
  if (!knownViewer || knownViewerId !== id) {
    knownViewerId = id;
    knownViewer = (async () => {
      const result = await supabase().from('profiles').select('global_role').eq('id', id).single();
      if (result.error) throw new Error(result.error.message);
      const role = (result.data as { global_role: Viewer['role'] } | null)?.global_role ?? 'user';
      return { id, role };
    })();
    // Une erreur (réseau…) n'est pas gardée : on réessaiera au prochain appel.
    knownViewer.catch(() => {
      knownViewer = null;
    });
  }
  return knownViewer;
}

/** Données des groupes lisibles par la personne connectée. */
export interface GroupContext {
  viewer: Viewer;
  feePercent: number;
  graceDays: number;
  groups: Group[];
  memberships: Membership[];
  rounds: Round[];
  payments: Payment[];
  penalties: PenaltyRow[];
  communityNames: Map<string, string>;
  /** Personnes citées : numéro et reversement seulement pour ceux que l'on gère. */
  people: Map<string, PublicUser>;
  /**
   * Statuts calculés par le serveur (group_round_statuses) pour les tours commencés :
   * parts payées, et statut de chacun quand on a le droit de le voir.
   */
  roundStatuses: Map<string, RoundStatuses>;
  /**
   * Nombre de bénéficiaires de chaque tour. Un membre ne voit que ses propres parts
   * bénéficiaires : ce nombre fixe quand même sa part de la cagnotte.
   */
  beneficiaryCounts: Map<string, number>;
}

interface OrderView {
  orders: Array<{ membershipId: string; payoutOrder: number }>;
  beneficiaryCounts: Record<string, number>;
}

interface RoundStatuses {
  paidCount: number;
  statuses: Record<string, PaymentStatus>;
}

const PROFILE_COLUMNS =
  'id, first_name, last_name, avatar_url, phone, payout_phone, payout_method, deleted_at';

async function loadPeople(ids: string[]): Promise<Map<string, PublicUser>> {
  const people = new Map<string, PublicUser>();
  if (ids.length === 0) return people;
  // Profils complets : ceux que l'on gère (RLS profiles_select) ; noms seuls pour les autres.
  const full = rows<ProfileRow>(
    await supabase().from('profiles').select(PROFILE_COLUMNS).in('id', ids),
  );
  for (const row of full) {
    people.set(
      row.id,
      row.deleted_at
        ? { id: row.id, firstName: 'Compte', lastName: 'supprimé' }
        : {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            avatarUrl: row.avatar_url ?? undefined,
            phone: row.phone ?? undefined,
            payoutPhone: row.payout_phone ?? undefined,
            payoutMethod: row.payout_method ?? undefined,
          },
    );
  }
  const missing = ids.filter((id) => !people.has(id));
  if (missing.length > 0) {
    const names = await rpc<ProfileRow[]>('public_profiles', { ids: missing });
    for (const row of names) {
      people.set(row.id, {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        avatarUrl: row.avatar_url ?? undefined,
      });
    }
  }
  return people;
}

/** Chargements en cours, par groupes et par personne : les blocs d'un même écran les partagent. */
const inflight = new Map<string, Promise<GroupContext>>();

/**
 * Données des groupes donnés pour la personne connectée. Plusieurs blocs d'un écran (groupe,
 * tours, membres, dettes…) demandent le même contexte au même moment : un seul chargement
 * est fait et partagé ; rien n'est gardé ensuite (pas de données périmées).
 */
export async function loadContext(groupRows: GroupRow[], viewer?: Viewer): Promise<GroupContext> {
  const me = viewer ?? (await currentViewer());
  const key = `${me.id}|${groupRows
    .map((row) => row.id)
    .sort()
    .join(',')}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const loading = loadContextNow(groupRows, me).finally(() => inflight.delete(key));
  inflight.set(key, loading);
  return loading;
}

async function loadContextNow(groupRows: GroupRow[], me: Viewer): Promise<GroupContext> {
  const client = supabase();
  const groups = groupRows.map(toGroup);
  const ids = groups.map((group) => group.id);
  const communityIds = [...new Set(groups.flatMap((group) => group.communityId ?? []))];

  const empty = Promise.resolve({ data: [], error: null });
  const [
    membershipRows,
    roundRows,
    communityRows,
    settings,
    orderView,
    paymentRows,
    penaltyRows,
    statuses,
  ] = await Promise.all([
    ids.length
      ? client
          .from('memberships')
          .select('id, group_id, user_id, role, status, joined_at')
          .in('group_id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client
          .from('rounds')
          .select(
            'id, group_id, cycle, number, open_date, due_date, recipient_type, pot_amount, status, paid_out_at, payout_validated_by, payout_blocked_at, payout_block_reason, payout_requested_at, round_beneficiaries (membership_id, amount, sent_at, sent_method, sent_ref, received_at)',
          )
          .in('group_id', ids)
          .order('number')
      : Promise.resolve({ data: [], error: null }),
    communityIds.length
      ? client.from('communities').select('id, name').in('id', communityIds)
      : Promise.resolve({ data: [], error: null }),
    rpc<{ payment?: { feePercent?: number }; rules?: { graceDays?: number } } | null>(
      'public_settings',
    ),
    // Ordre de passage confidentiel (…_calendrier_confidentiel.sql) : mon rang, ou tous les
    // rangs si je gère le groupe ; et le nombre de bénéficiaires de chaque tour.
    ids.length
      ? rpc<OrderView>('group_order_view', { p_groups: ids })
      : Promise.resolve<OrderView>({ orders: [], beneficiaryCounts: {} }),
    // Paiements et pénalités des tours de ces groupes (filtrés par le groupe de leur tour,
    // sans attendre la liste des tours).
    ids.length
      ? client
          .from('payments')
          .select(
            'id, round_id, user_id, amount, contribution_amount, membership_fee_amount, late_penalty_amount, service_fee_amount, method, status, provider_ref, paid_at, created_at, rounds!inner (group_id)',
          )
          .in('rounds.group_id', ids)
          .order('created_at')
      : empty,
    ids.length
      ? client
          .from('penalties')
          .select('round_id, user_id, amount, rounds!inner (group_id)')
          .in('rounds.group_id', ids)
      : empty,
    ids.length
      ? rpc<Record<string, RoundStatuses>>('group_round_statuses', { p_groups: ids })
      : Promise.resolve<Record<string, RoundStatuses>>({}),
  ]);
  const ranks = new Map(orderView.orders.map((item) => [item.membershipId, item.payoutOrder]));

  const memberships = rows<MembershipRow>(membershipRows).map((row) =>
    toMembership({ ...row, payout_order: ranks.get(row.id) ?? null }),
  );
  const rawRounds = rows<RoundRow>(roundRows);
  const rounds = rawRounds.map((row) => toRound(row, memberships));

  const personIds = new Set<string>(groups.map((group) => group.adminId));
  for (const membership of memberships) personIds.add(membership.userId);

  return {
    viewer: me,
    feePercent: settings?.payment?.feePercent ?? 0,
    graceDays: settings?.rules?.graceDays ?? 0,
    groups,
    memberships,
    rounds,
    payments: rows<PaymentRow>(paymentRows).map(toPayment),
    penalties: rows<PenaltyRow>(penaltyRows),
    communityNames: new Map(
      rows<{ id: string; name: string }>(communityRows).map((item) => [item.id, item.name]),
    ),
    people: await loadPeople([...personIds]),
    roundStatuses: new Map(Object.entries(statuses ?? {})),
    beneficiaryCounts: new Map(Object.entries(orderView.beneficiaryCounts)),
  };
}

// --- Règles (mêmes que services/mock/access.ts et lifecycle.ts) -------------------

export function membershipOf(ctx: GroupContext, groupId: string, userId: string) {
  const mine = ctx.memberships.filter((item) => item.groupId === groupId && item.userId === userId);
  return (
    mine.find((item) => item.status === 'active') ?? mine.find((item) => item.status !== 'removed')
  );
}

export function activeMemberships(ctx: GroupContext, groupId: string): Membership[] {
  return ctx.memberships
    .filter((item) => item.groupId === groupId && item.status === 'active')
    .sort((a, b) => (a.payoutOrder ?? 999) - (b.payoutOrder ?? 999));
}

export function canManage(ctx: GroupContext, group: Group): boolean {
  if (ctx.viewer.role === 'super_admin' || group.adminId === ctx.viewer.id) return true;
  const membership = membershipOf(ctx, group.id, ctx.viewer.id);
  return (
    membership?.status === 'active' &&
    (membership.role === 'owner' || membership.role === 'co_admin')
  );
}

export function currentRoundOf(ctx: GroupContext, group: Group): Round | undefined {
  return ctx.rounds.find(
    (round) =>
      round.groupId === group.id &&
      (round.status === 'open' || round.status === 'ready_for_payout'),
  );
}

export function cycleRounds(ctx: GroupContext, group: Group): Round[] {
  return ctx.rounds
    .filter((round) => round.groupId === group.id && round.cycle === group.currentCycle)
    .sort((a, b) => a.number - b.number);
}

export function penaltyFor(ctx: GroupContext, roundId: string, userId: string): number {
  return ctx.penalties
    .filter((item) => item.round_id === roundId && item.user_id === userId)
    .reduce((sum, item) => sum + item.amount, 0);
}

/** Statut d'une personne pour un tour, tel que le serveur le calcule (private.member_status). */
export function memberStatus(ctx: GroupContext, round: Round, userId: string): PaymentStatus {
  return ctx.roundStatuses.get(round.id)?.statuses[userId] ?? 'pending';
}

/** Parts payées sur un tour (une personne paie pour toutes ses parts). */
export function paidCountOf(ctx: GroupContext, round: Round): number {
  return ctx.roundStatuses.get(round.id)?.paidCount ?? 0;
}

/** Frais d'adhésion déjà payés par cette personne dans ce groupe. */
export function hasPaidMembershipFee(ctx: GroupContext, groupId: string, userId: string): boolean {
  const roundIds = new Set(ctx.rounds.filter((r) => r.groupId === groupId).map((r) => r.id));
  return ctx.payments.some(
    (p) =>
      roundIds.has(p.roundId) &&
      p.userId === userId &&
      p.status === 'paid' &&
      (p.membershipFeeAmount ?? 0) > 0,
  );
}

export function amountDue(ctx: GroupContext, group: Group, round: Round, userId: string): number {
  const shares = activeMemberships(ctx, group.id).filter((m) => m.userId === userId).length;
  const total = contributionPerTurn(group) * shares + penaltyFor(ctx, round.id, userId);
  // Versements déjà réussis sur ce tour (paiement par jours ou par périodes).
  const paid = ctx.payments
    .filter((p) => p.roundId === round.id && p.userId === userId && p.status === 'paid')
    .reduce((sum, p) => sum + (p.contributionAmount ?? p.amount) + (p.latePenaltyAmount ?? 0), 0);
  const fee = hasPaidMembershipFee(ctx, group.id, userId) ? 0 : (group.membershipFeeAmount ?? 0);
  return Math.max(0, total - paid) + fee;
}

export function person(ctx: GroupContext, userId: string, withPhone: boolean): PublicUser {
  const known = ctx.people.get(userId) ?? { id: userId, firstName: 'Compte', lastName: 'inconnu' };
  if (withPhone) return known;
  return {
    id: known.id,
    firstName: known.firstName,
    lastName: known.lastName,
    avatarUrl: known.avatarUrl,
  };
}

// --- Vues ----------------------------------------------------------------------

export function buildOverview(ctx: GroupContext, group: Group): GroupOverview {
  const viewerId = ctx.viewer.id;
  const membership = membershipOf(ctx, group.id, viewerId);
  const members = activeMemberships(ctx, group.id);
  const rounds = cycleRounds(ctx, group);
  const current = currentRoundOf(ctx, group);
  const manager = canManage(ctx, group);
  const isActiveMember = membership?.status === 'active';
  const myStatus = current && isActiveMember ? memberStatus(ctx, current, viewerId) : undefined;
  const collected = (round: Round) =>
    ctx.payments
      .filter((p) => p.roundId === round.id && p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);
  const myMembershipIds = new Set(
    members.filter((item) => item.userId === viewerId).map((item) => item.id),
  );
  const myTurn = rounds.find(
    (round) =>
      round.status !== 'paid_out' &&
      round.recipientType !== 'platform' &&
      (round.beneficiaryMembershipIds?.some((id) => myMembershipIds.has(id)) ?? false),
  );
  // Ma part de la cagnotte (plusieurs parts par tour : partage à parts égales). La base
  // ne fixe le montant de chaque bénéficiaire qu'au versement : avant, il vaut 0.
  const myTurnForUser = myTurn
    ? {
        ...myTurn,
        potAmount: personPayout(
          myTurn.potAmount,
          myTurn.beneficiaryMembershipIds ?? [],
          myMembershipIds,
        ),
      }
    : undefined;
  const currentBeneficiaries =
    current && current.recipientType !== 'platform'
      ? [
          ...new Map(
            members
              .filter((item) => current.beneficiaryMembershipIds?.includes(item.id))
              .map((item) => [item.userId, person(ctx, item.userId, manager)]),
          ).values(),
        ]
      : [];
  const nextPot = computePot(contributionPerTurn(group), group.maxMembers);
  const due =
    myStatus && myStatus !== 'paid' && current ? amountDue(ctx, group, current, viewerId) : 0;
  const admin = ctx.people.get(group.adminId);
  const hidePot = current?.recipientType === 'platform' && !manager;

  return {
    group,
    communityName: group.communityId ? ctx.communityNames.get(group.communityId) : undefined,
    adminName: admin ? `${admin.firstName} ${admin.lastName}` : '—',
    canManage: manager,
    myRole: membership?.role,
    myMembershipStatus: membership?.status,
    activeMemberCount: new Set(members.map((item) => item.userId)).size,
    activeShareCount: members.length,
    pendingRequestCount: ctx.memberships.filter(
      (item) => item.groupId === group.id && item.status === 'pending',
    ).length,
    potAmount: hidePot ? 0 : (current?.potAmount ?? nextPot),
    totalRounds:
      rounds.length ||
      Math.ceil(group.maxMembers / Math.max(1, group.sharesPerRound ?? 1)) +
        (group.reserveFinalTurn ? 1 : 0),
    currentRound: hidePot && current ? { ...current, potAmount: 0 } : current,
    currentBeneficiary: currentBeneficiaries[0],
    currentBeneficiaries,
    paidCount: current ? paidCountOf(ctx, current) : 0,
    totalCollected: rounds
      .filter((round) => manager || round.recipientType !== 'platform')
      .reduce((sum, round) => sum + collected(round), 0),
    myStatus,
    myAmountDue: due,
    myMembershipFeeDue:
      isActiveMember && !hasPaidMembershipFee(ctx, group.id, viewerId)
        ? (group.membershipFeeAmount ?? 0)
        : 0,
    myPenalty: current && isActiveMember ? penaltyFor(ctx, current.id, viewerId) : 0,
    myServiceFee: serviceFee(due, ctx.feePercent),
    myPeriodAmount:
      group.contributionAmount * members.filter((item) => item.userId === viewerId).length,
    feePercent: ctx.feePercent,
    myTurn: myTurnForUser,
    orderIsSet: members.length > 0 && members.every((m) => typeof m.payoutOrder === 'number'),
  };
}

export function buildMemberViews(ctx: GroupContext, group: Group): MemberView[] {
  const manager = canManage(ctx, group);
  // Confidentiel : un membre ne voit que son propre statut de paiement ; les
  // administrateurs du groupe voient celui de tous.
  const showStatus = (userId: string) => manager || userId === ctx.viewer.id;
  const current = currentRoundOf(ctx, group);
  const memberships = ctx.memberships
    .filter(
      (m) =>
        m.groupId === group.id && (m.status === 'active' || (manager && m.status === 'pending')),
    )
    .sort((a, b) => (a.payoutOrder ?? 999) - (b.payoutOrder ?? 999));
  const shareCounts = new Map<string, number>();
  const shareNumbers = new Map<string, number>();
  for (const membership of memberships) {
    if (membership.status !== 'active') continue;
    const number = (shareCounts.get(membership.userId) ?? 0) + 1;
    shareCounts.set(membership.userId, number);
    shareNumbers.set(membership.id, number);
  }
  const views = memberships.map((membership) => ({
    membership,
    user: person(ctx, membership.userId, manager),
    shareNumber: shareNumbers.get(membership.id) ?? 1,
    shareCount: shareCounts.get(membership.userId) ?? 1,
    currentStatus:
      showStatus(membership.userId) && current && membership.status === 'active'
        ? memberStatus(ctx, current, membership.userId)
        : undefined,
  }));
  if (manager) return views;
  // Confidentiel : le nombre de parts des autres n'est pas transmis (une ligne par personne).
  return views
    .filter((view) => view.user.id === ctx.viewer.id || view.shareNumber === 1)
    .map((view) => (view.user.id === ctx.viewer.id ? view : { ...view, shareCount: 1 }));
}

/** Retards sur le tour en cours des groupes actifs (somme due, pénalité comprise). */
export function lateEntries(ctx: GroupContext) {
  return ctx.groups
    .filter((group) => group.status === 'active')
    .flatMap((group) => {
      const round = currentRoundOf(ctx, group);
      if (!round) return [];
      const userIds = new Set(activeMemberships(ctx, group.id).map((item) => item.userId));
      return [...userIds]
        .filter((userId) => memberStatus(ctx, round, userId) === 'late')
        .map((userId) => ({
          userId,
          groupId: group.id,
          groupName: group.name,
          roundNumber: round.number,
          amount: amountDue(ctx, group, round, userId),
        }));
    });
}

/** Paiements (lisibles) avec leur groupe et leur tour, du plus récent au plus ancien. */
export function transactionRows(ctx: GroupContext, userId?: string): TransactionRow[] {
  const rounds = new Map(ctx.rounds.map((round) => [round.id, round]));
  const groups = new Map(ctx.groups.map((group) => [group.id, group]));
  const date = (payment: Payment) => new Date(payment.createdAt ?? payment.paidAt ?? 0).getTime();
  return ctx.payments
    .filter((payment) => !userId || payment.userId === userId)
    .sort((a, b) => date(b) - date(a))
    .flatMap((payment) => {
      const round = rounds.get(payment.roundId);
      const group = round ? groups.get(round.groupId) : undefined;
      if (!round || !group) return [];
      return [
        {
          payment,
          user: person(ctx, payment.userId, true),
          groupId: group.id,
          groupName: group.name,
          roundNumber: round.number,
        },
      ];
    });
}

/**
 * Attendu d'un tour : cotisations de toutes les parts, frais d'adhésion (payés sur ce tour,
 * ou encore dus s'il n'est pas versé) et pénalités. Un tour à venir n'attend rien.
 */
export function roundExpected(ctx: GroupContext, round: Round): number {
  if (round.status === 'upcoming') return 0;
  const group = ctx.groups.find((item) => item.id === round.groupId);
  if (!group) return 0;
  const members = activeMemberships(ctx, group.id);
  const paid = ctx.payments.filter((p) => p.roundId === round.id && p.status === 'paid');
  const fees = [...new Set(members.map((item) => item.userId))].reduce((sum, userId) => {
    const paidHere = paid.find((p) => p.userId === userId)?.membershipFeeAmount ?? 0;
    if (paidHere > 0) return sum + paidHere;
    const stillDue = round.status !== 'paid_out' && !hasPaidMembershipFee(ctx, group.id, userId);
    return sum + (stillDue ? (group.membershipFeeAmount ?? 0) : 0);
  }, 0);
  const penalties = ctx.penalties
    .filter((p) => p.round_id === round.id)
    .reduce((sum, p) => sum + p.amount, 0);
  return contributionPerTurn(group) * members.length + fees + penalties;
}

/** Encaissé sur un tour : paiements réussis (frais d'adhésion et pénalités compris). */
export function roundCollected(ctx: GroupContext, round: Round): number {
  return ctx.payments
    .filter((p) => p.roundId === round.id && p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);
}
