// Membres de la plateforme (super admin) sur Supabase : lectures par les tables (le super
// admin voit tout), actions par les fonctions SQL de …_membres_admins.sql et les Edge
// Functions member-create, member-phone-change et admin-pin-reset.
import { ServiceError } from '@/lib/errors';
import { fullName, searchable } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { MemberProfile, MemberSummary, User } from '@/types';
import type { MemberService } from '../member.service';
import { groupRows } from './group.supabase';
import { lateEntries, loadContext, transactionRows, type GroupContext } from './groupData';
import { invoke, requireOnline, rows, rpc } from './rpc';

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

const PROFILE_COLUMNS =
  'id, first_name, last_name, phone, avatar_url, global_role, is_suspended, payout_phone, payout_method, deleted_at, created_at';

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

/** Comptes gérables (tous sauf le super admin), avec leur contexte de groupes. */
async function load(userId?: string) {
  let query = supabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .neq('global_role', 'super_admin')
    .is('deleted_at', null);
  if (userId) query = query.eq('id', userId);
  const users = rows<ProfileRow>(await query).map(toUser);
  const [ctx, pins] = await Promise.all([
    loadContext(await groupRows()),
    users.length
      ? rpc<Array<{ user_id: string; pin_pending: boolean }>>('admin_pin_pending', {
          p_users: users.map((user) => user.id),
        })
      : Promise.resolve([]),
  ]);
  if (ctx.viewer.role !== 'super_admin') {
    throw new ServiceError('Réservé au super administrateur.', 'forbidden');
  }
  const pinPending = new Map(pins.map((row) => [row.user_id, row.pin_pending]));
  return { users, ctx, pinPending };
}

function summarize(
  user: User,
  ctx: GroupContext,
  lates: ReturnType<typeof lateEntries>,
  pinPending: Map<string, boolean>,
): MemberSummary {
  return {
    user,
    groupCount: new Set(
      ctx.memberships
        .filter((item) => item.userId === user.id && item.status === 'active')
        .map((item) => item.groupId),
    ).size,
    lateCount: lates.filter((late) => late.userId === user.id).length,
    pinPending: pinPending.get(user.id) ?? true,
  };
}

export function createSupabaseMemberService(): MemberService {
  return {
    async list(query = '') {
      const { users, ctx, pinPending } = await load();
      const lates = lateEntries(ctx);
      const words = searchable(query.trim());
      const digits = query.replace(/\D/g, '');
      return users
        .filter((user) => {
          if (!words) return true;
          // Un numéro se cherche par ses chiffres, un nom par ses lettres.
          if (digits.length >= 3 && user.phone.includes(digits)) return true;
          return searchable(fullName(user)).includes(words);
        })
        .sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr'))
        .map((user) => summarize(user, ctx, lates, pinPending));
    },

    async get(userId): Promise<MemberProfile> {
      const { users, ctx, pinPending } = await load(userId);
      const user = users[0];
      if (!user) throw new ServiceError('Ce compte a été supprimé.', 'not_found');
      const lates = lateEntries(ctx);
      const groups = ctx.groups.flatMap((group) => {
        const mine = ctx.memberships.filter(
          (item) =>
            item.groupId === group.id && item.userId === user.id && item.status !== 'removed',
        );
        const membership = mine.find((item) => item.status === 'active') ?? mine[0];
        if (!membership) return [];
        return [
          {
            group,
            role: membership.role,
            status: membership.status,
            shareCount: mine.filter((item) => item.status === 'active').length,
          },
        ];
      });
      const groupNames = new Map(ctx.groups.map((group) => [group.id, group.name]));
      const received = ctx.rounds
        .filter(
          (round) =>
            round.status === 'paid_out' &&
            round.recipientType !== 'platform' &&
            (round.beneficiaryAmounts?.[user.id] ?? 0) > 0,
        )
        .map((round) => ({
          groupId: round.groupId,
          groupName: groupNames.get(round.groupId) ?? '—',
          round,
        }));
      return {
        summary: summarize(user, ctx, lates, pinPending),
        groups,
        payments: transactionRows(ctx, user.id),
        lates: lates
          .filter((late) => late.userId === user.id)
          .map(({ groupId, groupName, roundNumber, amount }) => ({
            groupId,
            groupName,
            roundNumber,
            amount,
          })),
        received,
      };
    },

    async create(input) {
      const reply = await invoke<{ id: string }>('member-create', {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone.replace(/\D/g, ''),
      });
      return reply.id;
    },

    async block(userId) {
      requireOnline();
      await rpc('member_block', { p_user: userId });
    },

    async unblock(userId) {
      requireOnline();
      await rpc('member_unblock', { p_user: userId });
    },

    async resetPin(userId) {
      await invoke('admin-pin-reset', { userId });
    },

    async changePhone(userId, newPhone, code) {
      await invoke('member-phone-change', {
        userId,
        phone: newPhone.replace(/\D/g, ''),
        code,
      });
    },
  };
}
