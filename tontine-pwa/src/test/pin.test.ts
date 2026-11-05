// Parcours de connexion : numéro → code SMS → PIN (créé ou saisi), blocage après 5 erreurs.
import { isWeakPin } from '@/lib/validators';
import { DEMO_PIN } from '@/mocks/pins';
import { authService } from '@/services';
import { resetDatabase } from '@/services/mock/db';
import { lastOtpFor } from '@/services/mock/otp';

const AWA = '772345678'; // compte de démonstration (PIN déjà créé)
const NEW_NUMBER = '775550000'; // numéro sans compte
const INVITE = 'BUR92X'; // groupe de démonstration pas encore démarré

/** Envoie un code SMS au numéro puis le saisit, comme le ferait l'utilisateur. */
async function verifyBySms(phone: string, inviteCode?: string) {
  await authService.sendOtp(phone, inviteCode);
  return authService.verifyOtp(phone, lastOtpFor(phone) ?? '');
}

describe('isWeakPin', () => {
  it('refuse les chiffres identiques et les suites', () => {
    for (const pin of ['0000', '7777', '1234', '4321', '6789']) expect(isWeakPin(pin)).toBe(true);
  });

  it('accepte un PIN ordinaire', () => {
    for (const pin of ['2580', '1397', '9051']) expect(isWeakPin(pin)).toBe(false);
  });
});

describe('connexion par SMS puis PIN', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('le code SMS est aléatoire, sert une seule fois, et un code faux est refusé', async () => {
    await authService.sendOtp(AWA);
    const code = lastOtpFor(AWA) ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(authService.verifyOtp(AWA, wrong)).rejects.toThrow(/Code incorrect/);
    await authService.verifyOtp(AWA, code);
    await expect(authService.verifyOtp(AWA, code)).rejects.toThrow(/Aucun code/);
  }, 10_000);

  it('le code SMS ne suffit pas à ouvrir la session : le PIN est demandé ensuite', async () => {
    const result = await verifyBySms(AWA);
    expect(result).toMatchObject({ isNewAccount: false, hasPin: true, firstName: 'Awa' });
    expect((await authService.getSession()).user).toBeNull();
    const user = await authService.loginWithPin(AWA, DEMO_PIN);
    expect(user.firstName).toBe('Awa');
    expect((await authService.getSession()).user?.id).toBe(user.id);
  }, 10_000);

  it('nouveau numéro sans invitation : refusé, aucun code envoyé', async () => {
    await expect(authService.sendOtp(NEW_NUMBER)).rejects.toThrow(/Contactez votre administrateur/);
    await expect(authService.sendOtp(NEW_NUMBER, 'ZZZZ99')).rejects.toThrow(/pas encore inscrit/);
    expect(lastOtpFor(NEW_NUMBER)).toBeUndefined();
  });

  it('nouveau numéro : profil, puis PIN (pas trop simple), puis session ouverte', async () => {
    expect(await verifyBySms(NEW_NUMBER, INVITE)).toMatchObject({
      isNewAccount: true,
      hasPin: false,
    });
    expect((await authService.getSession()).needsProfile).toBe(true);
    await authService.completeProfile({ firstName: 'Rama', lastName: 'Diouf' });
    await expect(authService.setPin('1111')).rejects.toThrow(/facile/);
    const user = await authService.setPin('2580');
    expect(user.firstName).toBe('Rama');
    await authService.logout();
    await expect(authService.loginWithPin(NEW_NUMBER, '2580')).resolves.toBeTruthy();
  }, 15_000);

  it('bloque le PIN après 5 erreurs ; après le code SMS, un nouveau PIN le remplace', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await expect(authService.loginWithPin(AWA, '9999')).rejects.toThrow(/Il vous reste/);
    }
    await expect(authService.loginWithPin(AWA, '9999')).rejects.toThrow(/bloqué/);
    // Même le bon PIN ne suffit plus.
    await expect(authService.loginWithPin(AWA, DEMO_PIN)).rejects.toThrow();
    expect((await verifyBySms(AWA)).hasPin).toBe(false);
    await authService.setPin('2580');
    await authService.logout();
    await expect(authService.loginWithPin(AWA, '2580')).resolves.toBeTruthy();
  }, 20_000);

  it('sans numéro prouvé par SMS, impossible de remplacer un PIN', async () => {
    await expect(authService.setPin('2580')).rejects.toThrow(/Session expirée/);
  }, 10_000);

  it('sur ordinateur : PIN direct si le numéro en a un, sinon code SMS', async () => {
    expect(await authService.loginMethod(AWA)).toBe('pin');
    expect(await authService.loginMethod(NEW_NUMBER)).toBe('otp');
    // PIN bloqué : il faut repasser par le SMS.
    for (let attempt = 1; attempt <= 5; attempt++) {
      await authService.loginWithPin(AWA, '9999').catch(() => undefined);
    }
    expect(await authService.loginMethod(AWA)).toBe('otp');
  }, 20_000);
});
