// Paiement en ligne avec les vrais services contre Supabase local, sans clés PayTech :
// payments-initiate renvoie la page simulée, payments-simulate confirme par le même chemin
// qu'une notification PayTech. Une fausse notification est refusée et tracée.
// Comptes et données du test effacés à la fin (journaux compris).
import {
  groupService,
  membershipService,
  paymentService,
  roundService,
  simulatedCheckout,
} from '@/services';
import { signInAs, sql } from './local';

const ADMIN = '00000000-0000-4000-8000-00000000b002';
const AWA = '00000000-0000-4000-8000-00000000b011';
const COMMUNITY = '00000000-0000-4000-8000-00000000bc01';
const USERS = [ADMIN, AWA];
const AWA_PHONE = '700096611';

function cleanup() {
  const ids = `(${USERS.map((id) => `'${id}'`).join(', ')})`;
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    alter table public.security_events disable trigger security_events_append_only;
    delete from public.audit_log where actor_id in ${ids}
      or group_id in (select id from public.groups where created_by in ${ids});
    delete from public.security_events where user_id in ${ids}
      or detail like 'Notification de paiement refusée%';
    alter table public.audit_log enable trigger audit_log_append_only;
    alter table public.security_events enable trigger security_events_append_only;
    delete from public.provider_ledger where payment_id in (select id from public.payments where user_id in ${ids});
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
  // Comptes Auth complets : les Edge Functions vérifient la session.
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
      id || '@users.calebasse.invalid', '', now(), '{"provider": "email", "providers": ["email"]}',
      '{}', now(), now(), '', '', '', ''
    from unnest(array[${USERS.map((id) => `'${id}'`).join(', ')}]) as id;
    insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
      ('${ADMIN}', 'Test', 'Admin', '700096602', 'admin', '700096602'),
      ('${AWA}', 'Test', 'Awa', '${AWA_PHONE}', 'user', '${AWA_PHONE}');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test paiement');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN}');
  `);
});

afterAll(() => cleanup());

describe('paiement en ligne sur Supabase (sans clés PayTech)', () => {
  let roundId = '';

  it('prépare un groupe démarré', async () => {
    await signInAs(ADMIN);
    const today = new Date().toISOString().slice(0, 10);
    const group = await groupService.create({
      name: 'Tontine test paiement',
      contributionAmount: 1000,
      frequency: 'daily',
      turnLength: 2,
      maxMembers: 2,
      paymentDueDay: 1,
      startDate: new Date(`${today}T00:00:00Z`).toISOString(),
      attributionMode: 'random',
      reserveFinalTurn: false,
    });
    await membershipService.addByPhone(group.id, AWA_PHONE);
    await roundService.drawOrder(group.id);
    await groupService.start(group.id);
    roundId = (await roundService.list(group.id))[0]?.round.id ?? '';
    expect(roundId).not.toBe('');
  });

  it('un essai refusé passe en échec ; le suivant réussit', async () => {
    await signInAs(AWA);
    const first = await paymentService.initiatePayment({ roundId, method: 'wave' });
    expect(first.checkoutUrl).toBe(`/paiement/simulation?payment=${first.paymentId}`);
    const receipt = await paymentService.getReceipt(first.paymentId);
    // 1 000 F × 2 jours ; frais PayTech de 1,5 % payés en plus par le membre.
    expect(receipt.payment).toMatchObject({
      status: 'pending',
      amount: 2000,
      serviceFeeAmount: 30,
    });
    expect(await simulatedCheckout.get(first.paymentId)).toMatchObject({ amount: 2030 });
    await simulatedCheckout.complete(first.paymentId, false);
    expect((await paymentService.getReceipt(first.paymentId)).payment.status).toBe('failed');

    const second = await paymentService.initiatePayment({ roundId, method: 'orange_money' });
    await simulatedCheckout.complete(second.paymentId, true);
    expect((await paymentService.getReceipt(second.paymentId)).payment).toMatchObject({
      status: 'paid',
      method: 'orange_money',
    });
    await expect(paymentService.initiatePayment({ roundId, method: 'wave' })).rejects.toThrow(
      /déjà payé/,
    );
  });

  it('le paiement compte pour le tour ; on ne voit pas le reçu des autres', async () => {
    await signInAs(ADMIN);
    const rows = await paymentService.listForRound(roundId);
    expect(rows.find((row) => row.user.id === AWA)?.status).toBe('paid');
    const awaPayment = sql(
      `select id from public.payments where user_id = '${AWA}' and status = 'paid' limit 1`,
    );
    await expect(paymentService.getReceipt(awaPayment)).rejects.toThrow(/introuvable/);
    await paymentService.recordCash(roundId, ADMIN);
    expect(sql(`select status from public.rounds where id = '${roundId}'`)).toBe(
      'ready_for_payout',
    );
  });

  it('une notification de paiement non signée par PayTech est refusée et tracée', async () => {
    const pending = sql(
      `select count(*) from public.payments where user_id = '${AWA}' and status = 'paid'`,
    );
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payments-ipn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        type_event: 'sale_complete',
        ref_command: roundId,
        item_price: '2030',
        api_key_sha256: 'faux',
        api_secret_sha256: 'faux',
      }),
    });
    expect(response.status).toBe(403);
    expect(
      sql(
        `select count(*) > 0 from public.security_events where detail like 'Notification de paiement refusée%'`,
      ),
    ).toBe('t');
    expect(
      sql(`select count(*) from public.payments where user_id = '${AWA}' and status = 'paid'`),
    ).toBe(pending);
  });
});
