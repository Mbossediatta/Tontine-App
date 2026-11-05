// Un cycle complet avec les vrais services contre Supabase local : ordre, démarrage,
// paiements en espèces, versements, tour réservé au super admin, nouveau cycle.
// Comptes et données du test effacés à la fin (journaux compris).
import {
  adminService,
  groupService,
  membershipService,
  paymentService,
  roundService,
} from '@/services';
import { signInAs, sql } from './local';

const SUPER = '00000000-0000-4000-8000-00000000c001';
const ADMIN = '00000000-0000-4000-8000-00000000c002';
const AWA = '00000000-0000-4000-8000-00000000c011';
const COMMUNITY = '00000000-0000-4000-8000-00000000cc01';
const USERS = [SUPER, ADMIN, AWA];
const AWA_PHONE = '700097711';

function cleanup() {
  const ids = `(${USERS.map((id) => `'${id}'`).join(', ')})`;
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    alter table public.security_events disable trigger security_events_append_only;
    delete from public.audit_log where actor_id in ${ids}
      or group_id in (select id from public.groups where created_by in ${ids});
    delete from public.security_events where user_id in ${ids};
    alter table public.audit_log enable trigger audit_log_append_only;
    alter table public.security_events enable trigger security_events_append_only;
    delete from public.platform_earnings
      where group_id in (select id from public.groups where created_by in ${ids});
    delete from public.payments where user_id in ${ids};
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
    insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
      ('${SUPER}', 'Test', 'Super', '700097701', 'super_admin', null),
      ('${ADMIN}', 'Test', 'Admin', '700097702', 'admin', '700097702'),
      ('${AWA}', 'Test', 'Awa', '${AWA_PHONE}', 'user', '${AWA_PHONE}');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test cycle');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN}');
  `);
});

afterAll(() => cleanup());

describe('cycle sur Supabase', () => {
  let groupId = '';
  const today = new Date().toISOString().slice(0, 10);

  it('prépare un groupe journalier : 1 000 F par jour, tours de 2 jours, 2 parts', async () => {
    await signInAs(ADMIN);
    const group = await groupService.create({
      name: 'Tontine test cycle',
      contributionAmount: 1000,
      frequency: 'daily',
      turnLength: 2,
      maxMembers: 2,
      paymentDueDay: 1,
      startDate: new Date(`${today}T00:00:00Z`).toISOString(),
      attributionMode: 'manual',
      reserveFinalTurn: true,
    });
    groupId = group.id;
    await membershipService.addByPhone(groupId, AWA_PHONE);
    const drawn = await roundService.drawOrder(groupId);
    expect(drawn.map((item) => item.membership.payoutOrder).sort()).toEqual([1, 2]);
    // Ordre manuel : Awa d'abord.
    const awaFirst = [...drawn].sort((a) => (a.membership.userId === AWA ? -1 : 1));
    await roundService.setManualOrder(
      groupId,
      awaFirst.map((item) => item.membership.id),
    );
  });

  it('démarre : 2 tours de 2 jours et la période réservée', async () => {
    const started = await groupService.start(groupId);
    expect(started.status).toBe('active');
    const rounds = await roundService.list(groupId);
    expect(rounds.map((view) => view.round.recipientType)).toEqual([
      'members',
      'members',
      'platform',
    ]);
    expect(rounds[0]).toMatchObject({
      round: { status: 'open', potAmount: 4000, openDate: today },
      beneficiaries: [expect.objectContaining({ id: AWA })],
      paidCount: 0,
    });
    const overview = await groupService.get(groupId);
    expect(overview).toMatchObject({ potAmount: 4000, myStatus: 'pending', myAmountDue: 2000 });
  });

  it('encaisse en espèces, puis verse la cagnotte à Awa', async () => {
    const [first] = await roundService.list(groupId);
    if (!first) throw new Error('tour 1 absent');
    await paymentService.recordCash(first.round.id, AWA);
    const rows = await paymentService.listForRound(first.round.id);
    expect(rows.find((row) => row.user.id === AWA)?.status).toBe('paid');
    await expect(roundService.payout(first.round.id)).rejects.toThrow(/Tous les membres/);
    await paymentService.recordCash(first.round.id, ADMIN);
    expect((await adminService.dashboard()).todo.map((item) => item.kind)).toContain(
      'ready_for_payout',
    );
    await roundService.payout(first.round.id);
    const rounds = await roundService.list(groupId);
    expect(rounds[0]?.round.status).toBe('paid_out');
    expect(rounds[1]?.round.status).toBe('open');
  });

  it('Awa voit sa cagnotte reçue et ses paiements', async () => {
    await signInAs(AWA);
    const history = await paymentService.listMine(groupId);
    expect(history.payments).toHaveLength(1);
    expect(history.received).toHaveLength(1);
    const transactions = await paymentService.myTransactions();
    expect(transactions.map((item) => item.kind).sort()).toEqual(['contribution', 'payout']);
    expect(transactions.find((item) => item.kind === 'payout')).toMatchObject({ amount: 4000 });
    await expect(paymentService.recordCash('x', AWA)).rejects.toBeTruthy();
  });

  it('tour 2 puis période réservée, versée par le super admin ; nouveau cycle', async () => {
    await signInAs(ADMIN);
    const second = (await roundService.list(groupId))[1];
    if (!second) throw new Error('tour 2 absent');
    await paymentService.recordCash(second.round.id, AWA);
    await paymentService.recordCash(second.round.id, ADMIN);
    await roundService.payout(second.round.id);

    const reserved = (await roundService.list(groupId))[2];
    if (!reserved) throw new Error('période réservée absente');
    await paymentService.recordCash(reserved.round.id, AWA);
    await paymentService.recordCash(reserved.round.id, ADMIN);
    await expect(roundService.payout(reserved.round.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await signInAs(SUPER);
    await roundService.payout(reserved.round.id);
    expect(
      sql(
        `select sum(amount) from public.platform_earnings where group_id = '${groupId}' and kind = 'reserved_turn'`,
      ),
    ).toBe('4000');
    expect((await groupService.get(groupId)).group.status).toBe('finished');

    await signInAs(ADMIN);
    const restarted = await groupService.restartCycle(groupId, {
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      keepOrder: true,
    });
    expect(restarted).toMatchObject({ status: 'draft', currentCycle: 2 });
  });
});
