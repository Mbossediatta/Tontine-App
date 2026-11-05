// Test de bout en bout de la connexion (étape 4), contre Supabase local.
// Prérequis : `npm start`, `npm run reset`, puis `npm run functions` (SMS_MODE=console).
// Lancer : npm run test:auth
// Le code SMS est lu dans les journaux du conteneur des Edge Functions.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const CONTAINER = 'supabase_edge_runtime_calebasse';

let passed = 0;
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function call(fn, body, token) {
  const response = await fetch(`${API}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function rest(path, token, init = {}) {
  const response = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Codes SMS envoyés à ce numéro (journaux du conteneur local, du plus ancien au plus récent). */
function codesFor(phone) {
  const logs = spawnSync('docker', ['logs', '--since', '10m', CONTAINER], { encoding: 'utf8' });
  // Les journaux de la fonction sortent sur stderr.
  return (logs.stdout + logs.stderr)
    .split('\n')
    .filter((line) => line.includes(`[SMS local] ${phone}`))
    .map((line) => line.match(/est (\d{6})/)?.[1])
    .filter(Boolean);
}

function lastCode(phone) {
  const code = codesFor(phone).at(-1);
  assert.ok(code, `aucun SMS trouvé pour ${phone}`);
  return code;
}

/** Envoie un code et attend qu'il apparaisse dans les journaux (léger décalage). */
async function sendCode(phone) {
  const before = codesFor(phone).length;
  const sent = await call('auth-otp-send', { phone });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  for (let i = 0; i < 50 && codesFor(phone).length === before; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return lastCode(phone);
}

async function otp(phone) {
  const code = await sendCode(phone);
  const verified = await call('auth-otp-verify', { phone, code });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return verified.body;
}

const NEW_PHONE = `76${String(Date.now()).slice(-7)}`;
const AWA = '772345678';
const SUPER = '776502698';

console.log('Connexion — test de bout en bout');

await step('numéro invalide refusé', async () => {
  const r = await call('auth-otp-send', { phone: '12' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'invalid');
});

await step('nouveau numéro : méthode « otp »', async () => {
  const r = await call('auth-login-method', { phone: NEW_PHONE });
  assert.deepEqual(r.body, { method: 'otp' });
});

await step('code faux refusé et noté', async () => {
  const code = await sendCode(NEW_PHONE);
  const wrong = code === '000000' ? '111111' : '000000';
  const r = await call('auth-otp-verify', { phone: NEW_PHONE, code: wrong });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /Code incorrect/);
});

let proof;
await step('bon code : nouveau compte, pas de PIN, jeton de preuve', async () => {
  const r = await otp(NEW_PHONE);
  assert.equal(r.isNewAccount, true);
  assert.equal(r.hasPin, false);
  assert.ok(r.proofToken);
  proof = r.proofToken;
});

await step('un code ne sert qu’une fois', async () => {
  const r = await call('auth-otp-verify', { phone: NEW_PHONE, code: lastCode(NEW_PHONE) });
  assert.equal(r.status, 400);
});

await step('jeton de preuve falsifié refusé', async () => {
  const r = await call('auth-profile-create', { proofToken: proof.slice(0, -2) + 'aa', firstName: 'Test', lastName: 'Pirate' });
  assert.equal(r.status, 401);
});

await step('saisie suspecte refusée', async () => {
  const r = await call('auth-profile-create', { proofToken: proof, firstName: "x'; drop table--", lastName: 'Test' });
  assert.equal(r.status, 400);
});

await step('création du profil', async () => {
  const r = await call('auth-profile-create', { proofToken: proof, firstName: 'Seynabou', lastName: 'Test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const again = await call('auth-profile-create', { proofToken: proof, firstName: 'Seynabou', lastName: 'Test' });
  assert.equal(again.status, 409);
});

await step('PIN trop simple refusé', async () => {
  const r = await call('auth-pin-set', { proofToken: proof, pin: '1234' });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /trop facile/);
});

let session;
await step('création du PIN : la session s’ouvre', async () => {
  const r = await call('auth-pin-set', { proofToken: proof, pin: '2580' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.firstName, 'Seynabou');
  assert.ok(r.body.session.access_token);
  session = r.body.session.access_token;
});

await step('avec la session : lit son profil (RLS)', async () => {
  const r = await rest('profiles?select=first_name,phone', session);
  assert.deepEqual(r.body, [{ first_name: 'Seynabou', phone: NEW_PHONE }]);
});

await step('méthode « pin » une fois le PIN créé', async () => {
  const r = await call('auth-login-method', { phone: NEW_PHONE });
  assert.deepEqual(r.body, { method: 'pin' });
});

await step('connexion par PIN', async () => {
  const r = await call('auth-pin-login', { phone: NEW_PHONE, pin: '2580' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  session = r.body.session.access_token;
});

await step('connexion directe à Supabase Auth impossible sans le mot de passe interne', async () => {
  const response = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `221${NEW_PHONE}`, password: '2580' }),
  });
  assert.notEqual(response.status, 200);
});

await step('inscription publique à Supabase Auth bloquée', async () => {
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pirate@users.calebasse.invalid', password: 'motdepasse123' }),
  });
  assert.notEqual(response.status, 200);
});

await step('changement de PIN (PIN actuel exigé)', async () => {
  const wrong = await call('auth-pin-change', { currentPin: '9999', newPin: '3691' }, session);
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error.message, /Il vous reste 4 essais/);
  const ok = await call('auth-pin-change', { currentPin: '2580', newPin: '3691' }, session);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

await step('5 PIN faux : PIN bloqué, seul le SMS débloque', async () => {
  let last;
  for (let i = 0; i < 5; i++) last = await call('auth-pin-login', { phone: NEW_PHONE, pin: '0007' });
  assert.equal(last.status, 403);
  assert.match(last.body.error.message, /PIN bloqué/);
  const right = await call('auth-pin-login', { phone: NEW_PHONE, pin: '3691' });
  assert.equal(right.status, 409, 'même le bon PIN est refusé une fois bloqué');
  const method = await call('auth-login-method', { phone: NEW_PHONE });
  assert.deepEqual(method.body, { method: 'otp' });
  const again = await otp(NEW_PHONE);
  assert.equal(again.hasPin, false);
  const reset = await call('auth-pin-set', { proofToken: again.proofToken, pin: '4826' });
  assert.equal(reset.status, 200);
});

await step('compte du seed (Awa) : SMS puis PIN, session ouverte', async () => {
  const r = await otp(AWA);
  assert.equal(r.isNewAccount, false);
  assert.equal(r.firstName, 'Awa');
  const pin = await call('auth-pin-set', { proofToken: r.proofToken, pin: '1357' });
  assert.equal(pin.status, 200, JSON.stringify(pin.body));
  session = pin.body.session.access_token;
});

await step('le PIN ne sert pas de mot de passe Supabase (même avec l’identifiant interne)', async () => {
  const response = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a0000000-0000-0000-0000-000000000011@users.calebasse.invalid', password: '1357' }),
  });
  assert.equal(response.status, 400);
});

await step('un membre ne peut pas réinitialiser un PIN', async () => {
  const r = await call('admin-pin-reset', { userId: 'a0000000-0000-0000-0000-000000000012' }, session);
  assert.equal(r.status, 403);
});

let superSession;
await step('super admin : connexion tracée', async () => {
  const r = await otp(SUPER);
  const pin = await call('auth-pin-set', { proofToken: r.proofToken, pin: '8642' });
  assert.equal(pin.status, 200, JSON.stringify(pin.body));
  superSession = pin.body.session.access_token;
  const events = await rest('security_events?kind=eq.admin_login&select=kind', superSession);
  assert.ok(events.body.length >= 1);
});

await step('super admin : réinitialise le PIN d’Awa et ferme ses sessions', async () => {
  const r = await call('admin-pin-reset', { userId: 'a0000000-0000-0000-0000-000000000011' }, superSession);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const method = await call('auth-login-method', { phone: AWA });
  assert.deepEqual(method.body, { method: 'otp' });
  const login = await call('auth-pin-login', { phone: AWA, pin: '1357' });
  assert.equal(login.status, 409);
});

await step('journal de sécurité : échecs de PIN et de code notés', async () => {
  const r = await rest('security_events?select=kind', superSession);
  const kinds = new Set(r.body.map((e) => e.kind));
  for (const kind of ['pin_failed', 'pin_blocked', 'otp_failed', 'suspicious_input']) {
    assert.ok(kinds.has(kind), `événement ${kind} absent`);
  }
});

await step('limite : 5 codes par numéro et par heure', async () => {
  const phone = `75${String(Date.now()).slice(-7)}`;
  let last;
  for (let i = 0; i < 6; i++) last = await call('auth-otp-send', { phone });
  assert.equal(last.status, 429);
});

console.log(`\n${passed} étapes réussies.`);
