// Groupes et adhésions sur Supabase : lectures par les tables (RLS), écritures par les
// fonctions SQL de backend/supabase/migrations/…_groupes.sql.
import { ServiceError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Group, JoinPreview, UpdateGroupInput } from '@/types';
import type { GroupService } from '../group.service';
import type { MembershipService } from '../membership.service';
import {
  buildMemberViews,
  buildOverview,
  canManage,
  currentViewer,
  GROUP_COLUMNS,
  loadContext,
  toGroup,
  type GroupRow,
} from './groupData';
import { requireOnline, rows, rpc } from './rpc';

function selectGroups() {
  return supabase().from('groups').select(GROUP_COLUMNS).order('created_at', { ascending: false });
}

type GroupQuery = ReturnType<typeof selectGroups>;

/** Groupes lisibles (RLS), éventuellement filtrés. */
export async function groupRows(filter: (query: GroupQuery) => GroupQuery = (query) => query) {
  return rows<GroupRow>(
    await filter(selectGroups()),
    'Impossible de charger les groupes. Réessayez.',
  );
}

async function readGroup(groupId: string): Promise<Group> {
  const [row] = await groupRows((q) => q.eq('id', groupId));
  if (!row) throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
  return toGroup(row);
}

/** UpdateGroupInput → JSON : une clé présente mais vide est envoyée à null (effacement). */
function toPayload(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value ?? null]));
}

export function createSupabaseGroupService(): GroupService {
  return {
    async listMine() {
      const viewer = await currentViewer();
      const mine = rows<{ group_id: string }>(
        await supabase()
          .from('memberships')
          .select('group_id')
          .eq('user_id', viewer.id)
          .in('status', ['pending', 'active']),
      );
      const ids = [...new Set(mine.map((item) => item.group_id))];
      if (ids.length === 0) return [];
      const ctx = await loadContext(await groupRows((q) => q.in('id', ids)), viewer);
      return ctx.groups.map((group) => buildOverview(ctx, group));
    },

    async listDiscoverable() {
      const viewer = await currentViewer();
      if (viewer.role !== 'user') return [];
      const found = await rpc<GroupRow[]>('groups_discoverable');
      const ctx = await loadContext(found, viewer);
      return ctx.groups.map((group) => buildOverview(ctx, group));
    },

    async listManaged() {
      const ctx = await loadContext(await groupRows());
      return ctx.groups.filter((group) => canManage(ctx, group)).map((g) => buildOverview(ctx, g));
    },

    async get(groupId) {
      const ctx = await loadContext(await groupRows((q) => q.eq('id', groupId)));
      const group = ctx.groups[0];
      const overview = group ? buildOverview(ctx, group) : undefined;
      // Une demande en attente rend le groupe lisible, mais pas son contenu.
      if (!overview || (!overview.canManage && overview.myMembershipStatus !== 'active')) {
        throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
      }
      return overview;
    },

    async create({ photoUrl, ...input }) {
      requireOnline();
      const id = await rpc<string>('group_create', { p: toPayload(input) });
      if (input.paymentDueTime) {
        await rpc('group_set_due_time', { p_group: id, p_time: input.paymentDueTime });
      }
      if (photoUrl) await rpc('group_set_photo', { p_group: id, p_photo: photoUrl });
      return readGroup(id);
    },

    async update(groupId, input: UpdateGroupInput) {
      requireOnline();
      const { photoUrl, ...rest } = input;
      // La photo seule (réglages → « Photo du groupe ») n'appelle pas group_update.
      if (Object.keys(rest).length > 0) {
        await rpc('group_update', { p_group: groupId, p: toPayload(rest) });
      }
      if (rest.paymentDueTime) {
        await rpc('group_set_due_time', { p_group: groupId, p_time: rest.paymentDueTime });
      }
      if ('photoUrl' in input) {
        await rpc('group_set_photo', { p_group: groupId, p_photo: photoUrl ?? null });
      }
      return readGroup(groupId);
    },

    async start(groupId) {
      requireOnline();
      await rpc('group_start', { p_group: groupId });
      return readGroup(groupId);
    },

    async remove(groupId) {
      requireOnline();
      await rpc('group_remove', { p_group: groupId });
    },

    async regenerateInviteCode(groupId) {
      requireOnline();
      return rpc<string>('group_regenerate_invite', { p_group: groupId });
    },

    async restartCycle(groupId, { startDate, keepOrder }) {
      requireOnline();
      await rpc('group_restart_cycle', {
        p_group: groupId,
        p_start_date: startDate.slice(0, 10),
        p_keep_order: keepOrder,
      });
      return readGroup(groupId);
    },

    async getByInviteCode(code) {
      const preview = await rpc<Omit<JoinPreview, 'group'> & { group: GroupRow }>(
        'group_join_preview',
        { p_code: code },
      );
      return {
        ...preview,
        group: toGroup(preview.group),
        communityName: preview.communityName ?? undefined,
        myMembershipStatus: preview.myMembershipStatus ?? undefined,
      };
    },

    async requestJoin(code) {
      requireOnline();
      await rpc('group_request_join', { p_code: code });
    },

    async requestJoinOpen(groupId) {
      requireOnline();
      await rpc('group_request_join_open', { p_group: groupId });
    },

    async announce(groupId, message) {
      requireOnline();
      return rpc<number>('group_announce', { p_group: groupId, p_message: message });
    },
  };
}

export function createSupabaseMembershipService(): MembershipService {
  return {
    async list(groupId) {
      const ctx = await loadContext(await groupRows((q) => q.eq('id', groupId)));
      const group = ctx.groups[0];
      if (!group) throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
      return buildMemberViews(ctx, group);
    },

    async accept(membershipId) {
      requireOnline();
      await rpc('membership_accept', { p_membership: membershipId });
    },

    async reject(membershipId) {
      requireOnline();
      await rpc('membership_reject', { p_membership: membershipId });
    },

    async remove(membershipId) {
      requireOnline();
      await rpc('membership_remove', { p_membership: membershipId });
    },

    async setRole(membershipId, role) {
      requireOnline();
      await rpc('membership_set_role', { p_membership: membershipId, p_role: role });
    },

    async addByPhone(groupId, phone, shareCount = 1) {
      requireOnline();
      return rpc<number>('membership_add_by_phone', {
        p_group: groupId,
        p_phone: phone,
        p_share_count: shareCount,
      });
    },
  };
}
