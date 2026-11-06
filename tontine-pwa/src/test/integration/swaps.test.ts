// Échange de tour avec les vrais services contre Supabase local : demande d'un membre,
// accord du partenaire, validation de l'admin. Comptes et données effacés à la fin.
import { groupService, membershipService, roundService, swapService } from '@/services';
import { signInAs, sql } from './local';

const ADMIN = '00000000-0000-4000-8000-00000000f002';
const AWA = '00000000-0000-4000-8000-00000000f011';
const IBOU = '00000000-0000-4000-8000-00000000f012';
const COMMUNITY = '00000000-0000-4000-8000-00000000fc01';
const USERS = [ADMIN, AWA, IBOU];
const AWA_PHONE = '700096611';
const IBOU_PHONE = '700096612';

function cleanup() {
  const ids = `(${USERS.map((id) => `'${id}'`).join(', ')})`;
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    delete from public.audit_log where actor_id in ${ids}
      or group_id in (select id from public.groups where created_by in ${ids});
    alter table public.audit_log enable trigger audit_log_append_only;
    delete from public.groups where created_by in ${ids};
    delete from public.communities where id = '${COMMUNITY}';
    delete from public.profiles where id in ${ids};
    delete from auth.users where id in ${ids};
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
      ('${ADMIN}', 'Test', 'Admin', '700096602', 'admin'),
      ('${AWA}', 'Test', 'Awa', '${AWA_PHONE}', 'user'),
      ('${IBOU}', 'Test', 'Ibou', '${IBOU_PHONE}', 'user');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test échange');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN}');
  `);
});

afterAll(() => cleanup());

/** Numéro du tour où `userId` reçoit la cagnotte. */
async function roundOf(groupId: string, userId: string) {
  const rounds = await roundService.list(groupId);
  return rounds.find((view) => view.beneficiaries.some((person) => person.id === userId))?.round;
}

describe('échange de tour sur Supabase', () => {
  let groupId = '';

  it('démarre un groupe : Admin, Awa puis Ibou', async () => {
    await signInAs(ADMIN);
    const start = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const group = await groupService.create({
      name: 'Tontine test échange',
      contributionAmount: 5000,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 3,
      paymentDueDay: 5,
      startDate: start,
      attributionMode: 'manual',
      reserveFinalTurn: false,
    });
    groupId = group.id;
    await membershipService.addByPhone(groupId, AWA_PHONE);
    await membershipService.addByPhone(groupId, IBOU_PHONE);
    const drawn = await roundService.drawOrder(groupId);
    const rank = (userId: string) => [ADMIN, AWA, IBOU].indexOf(userId);
    await roundService.setManualOrder(
      groupId,
      [...drawn]
        .sort((a, b) => rank(a.membership.userId) - rank(b.membership.userId))
        .map((item) => item.membership.id),
    );
    await groupService.start(groupId);
    expect((await roundOf(groupId, AWA))?.number).toBe(2);
  });

  it('Awa propose son tour 2 contre le tour 3 (anonyme pour elle), Ibou accepte', async () => {
    await signInAs(AWA);
    const mine = await roundOf(groupId, AWA);
    // Calendrier confidentiel : Awa voit la date du tour 3, pas le nom de son bénéficiaire.
    const theirs = (await roundService.list(groupId)).find((view) => view.round.number === 3);
    expect(theirs?.beneficiaries).toEqual([]);
    expect(await roundOf(groupId, IBOU)).toBeUndefined();
    await swapService.request(mine?.id ?? '', theirs?.round.id ?? '');
    await expect(swapService.request(mine?.id ?? '', theirs?.round.id ?? '')).rejects.toThrow(
      /déjà en cours/,
    );

    await signInAs(IBOU);
    const [swap] = await swapService.list(groupId);
    expect(swap).toMatchObject({
      request: { status: 'pending_partner', requesterId: AWA },
      requesterRound: { number: 2 },
      partnerRound: { number: 3 },
    });
    await swapService.respond(swap?.request.id ?? '', true);
  });

  it('l’admin valide : Ibou reçoit au tour 2 et Awa au tour 3', async () => {
    await signInAs(ADMIN);
    const [swap] = await swapService.list(groupId);
    expect(swap?.request.status).toBe('pending_admin');
    await swapService.decide(swap?.request.id ?? '', true);
    expect((await roundOf(groupId, IBOU))?.number).toBe(2);
    expect((await roundOf(groupId, AWA))?.number).toBe(3);
    expect(
      sql(
        `select count(*) from public.audit_log where action = 'swap_approved' and group_id = '${groupId}'`,
      ),
    ).toBe('1');
  });
});
