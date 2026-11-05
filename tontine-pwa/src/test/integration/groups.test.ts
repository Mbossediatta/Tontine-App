// Groupes, adhésions et supervision : les vrais services de l'application contre
// Supabase local. Comptes et données du test effacés à la fin (journaux compris).
import { ServiceError } from '@/lib/errors';
import {
  adminService,
  groupService,
  membershipService,
  paymentService,
  roundService,
  swapService,
} from '@/services';
import { signInAs, sql } from './local';

const SUPER = '00000000-0000-4000-8000-00000000e001';
const ADMIN = '00000000-0000-4000-8000-00000000e002';
const AWA = '00000000-0000-4000-8000-00000000e011';
const IBOU = '00000000-0000-4000-8000-00000000e012';
const OUTSIDER = '00000000-0000-4000-8000-00000000e013';
const COMMUNITY = '00000000-0000-4000-8000-00000000ec01';
const USERS = [SUPER, ADMIN, AWA, IBOU, OUTSIDER];
const IBOU_PHONE = '700099912';

function cleanup() {
  const ids = USERS.map((id) => `'${id}'`).join(', ');
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    alter table public.security_events disable trigger security_events_append_only;
    delete from public.audit_log where actor_id in (${ids})
      or group_id in (select id from public.groups where created_by in (${ids}));
    delete from public.security_events where user_id in (${ids});
    alter table public.audit_log enable trigger audit_log_append_only;
    alter table public.security_events enable trigger security_events_append_only;
    delete from public.groups where created_by in (${ids});
    delete from public.communities where id = '${COMMUNITY}';
    delete from public.profiles where id in (${ids});
    delete from auth.users where id in (${ids});
  `);
}

beforeAll(() => {
  cleanup();
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
    select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
      'it-' || id || '@users.calebasse.invalid', now(), now()
    from unnest(array[${USERS.map((id) => `'${id}'`).join(', ')}]) as id;
    insert into public.profiles (id, first_name, last_name, phone, global_role) values
      ('${SUPER}', 'Test', 'Super', '700099901', 'super_admin'),
      ('${ADMIN}', 'Test', 'Admin', '700099902', 'admin'),
      ('${AWA}', 'Test', 'Awa', '700099911', 'user'),
      ('${IBOU}', 'Test', 'Ibou', '${IBOU_PHONE}', 'user'),
      ('${OUTSIDER}', 'Test', 'Dehors', '700099913', 'user');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test intégration');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN}');
  `);
});

afterAll(() => cleanup());

describe('groupes sur Supabase', () => {
  let groupId = '';
  let inviteCode = '';

  it('un admin crée un groupe dans sa communauté et en devient propriétaire', async () => {
    await signInAs(ADMIN);
    const group = await groupService.create({
      name: 'Tontine intégration',
      contributionAmount: 5000,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 3,
      paymentDueDay: 5,
      startDate: new Date('2030-01-05').toISOString(),
      attributionMode: 'random',
    });
    groupId = group.id;
    inviteCode = group.inviteCode;
    expect(group).toMatchObject({ communityId: COMMUNITY, adminId: ADMIN, status: 'draft' });

    const overview = await groupService.get(groupId);
    expect(overview).toMatchObject({
      canManage: true,
      myRole: 'owner',
      activeShareCount: 1,
      communityName: 'Communauté test intégration',
      adminName: 'Test Admin',
      potAmount: 15000,
    });
    expect((await groupService.listManaged()).map((item) => item.group.id)).toContain(groupId);
  });

  it('une participante rejoint par le code ; sa demande attend la validation', async () => {
    await signInAs(AWA);
    const preview = await groupService.getByInviteCode(inviteCode.toLowerCase());
    expect(preview).toMatchObject({
      placesLeft: 2,
      activeShareCount: 1,
      adminNames: ['Test Admin'],
    });
    await groupService.requestJoin(inviteCode);
    const mine = await groupService.listMine();
    expect(mine.find((item) => item.group.id === groupId)?.myMembershipStatus).toBe('pending');
    await expect(groupService.get(groupId)).rejects.toThrow(/ne faites pas partie/);
  });

  it('l’admin accepte, ajoute par numéro, nomme une co-admin', async () => {
    await signInAs(ADMIN);
    const before = await membershipService.list(groupId);
    const pending = before.find((item) => item.membership.status === 'pending');
    expect(pending?.user).toMatchObject({ firstName: 'Test', lastName: 'Awa', phone: '700099911' });
    expect((await adminService.dashboard()).todo.map((item) => item.kind)).toEqual([
      'join_request',
    ]);

    if (!pending) throw new Error('demande d’adhésion absente');
    await membershipService.accept(pending.membership.id);
    await expect(membershipService.addByPhone(groupId, '709999999')).rejects.toThrow(
      /Aucun compte avec ce numéro/,
    );
    expect(await membershipService.addByPhone(groupId, IBOU_PHONE)).toBe(1);
    const members = await membershipService.list(groupId);
    expect(members.filter((item) => item.membership.status === 'active')).toHaveLength(3);

    const awa = members.find((item) => item.membership.userId === AWA);
    if (!awa) throw new Error('part d’Awa absente');
    await membershipService.setRole(awa.membership.id, 'co_admin');
    const dashboard = await adminService.dashboard();
    expect(dashboard.todo).toEqual([]);
    expect(dashboard.groups.map((item) => item.group.id)).toContain(groupId);
  });

  it('les réglages se modifient, le code d’invitation se renouvelle', async () => {
    const updated = await groupService.update(groupId, {
      name: 'Tontine intégration bis',
      latePenalty: undefined,
    });
    expect(updated.name).toBe('Tontine intégration bis');
    const code = await groupService.regenerateInviteCode(groupId);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(code).not.toBe(inviteCode);
  });

  it('un membre voit le groupe sans les numéros des autres ; la co-admin peut gérer', async () => {
    await signInAs(IBOU);
    const overview = await groupService.get(groupId);
    expect(overview).toMatchObject({ canManage: false, activeMemberCount: 3 });
    const members = await membershipService.list(groupId);
    expect(members.every((item) => item.user.phone === undefined || item.user.id === IBOU)).toBe(
      true,
    );
    await signInAs(AWA);
    expect((await groupService.get(groupId)).canManage).toBe(true);
  });

  it('un refus de droits est une erreur claire, tracée au journal de sécurité', async () => {
    await signInAs(OUTSIDER);
    await expect(groupService.update(groupId, { name: 'Piratage' })).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Seuls les administrateurs du groupe peuvent faire cela.',
    });
    await expect(groupService.get(groupId)).rejects.toBeInstanceOf(ServiceError);
    // Le traçage part juste après le refus : on lui laisse le temps d'arriver.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      sql(
        `select count(*) from public.security_events where user_id = '${OUTSIDER}' and kind = 'access_denied'`,
      ),
    ).toBe('1');
  });

  it('avant le démarrage : aucun tour, et l’ordre est exigé pour démarrer', async () => {
    await signInAs(ADMIN);
    expect(await roundService.list(groupId)).toEqual([]);
    expect(await paymentService.listMine(groupId)).toEqual({ payments: [], received: [] });
    expect(await swapService.list(groupId)).toEqual([]);
    await expect(groupService.start(groupId)).rejects.toThrow(/Fixez d’abord l’ordre/);
  });

  it('le super admin suspend, réactive et confie le groupe', async () => {
    await signInAs(SUPER);
    expect((await adminService.listAdminChoices()).map((item) => item.id)).toContain(ADMIN);
    await adminService.suspendGroup(groupId);
    expect((await groupService.get(groupId)).group.status).toBe('suspended');
    await adminService.reactivateGroup(groupId);
    expect((await groupService.get(groupId)).group.status).toBe('draft');
    await adminService.transferGroup(groupId, COMMUNITY, ADMIN);
    expect(sql(`select count(*) from public.audit_log where group_id = '${groupId}'`)).toBe('5');
  });

  it('le propriétaire supprime le groupe en brouillon', async () => {
    await signInAs(ADMIN);
    await groupService.remove(groupId);
    expect(sql(`select count(*) from public.groups where id = '${groupId}'`)).toBe('0');
  });
});
