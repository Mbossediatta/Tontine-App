// Journal de sécurité (super administrateur) et traduction wolof de l'accueil.
import { deadlineLabel } from '@/features/member/dues';
import { monthNameIn, translate } from '@/i18n';
import { authService, groupService, reportService, settingsService } from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { resetDatabase } from '@/services/mock/db';

const AWA = '772345678'; // participante, PIN déjà créé

async function securityKinds() {
  await demoLogin('u-super');
  return (await reportService.securityLog()).map(({ event }) => event.kind);
}

describe('journal de sécurité', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('note un PIN incorrect, puis le blocage du PIN', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await authService.loginWithPin(AWA, '9999').catch(() => undefined);
    }
    const kinds = await securityKinds();
    expect(kinds.filter((kind) => kind === 'pin_failed').length).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain('pin_blocked');
  }, 20_000);

  it('refuse et signale une saisie qui ressemble à une injection', async () => {
    await demoLogin('u-admin1');
    await expect(
      groupService.create({
        communityId: 'c-ouakam',
        name: "Tontine'; DROP TABLE groups; --",
        contributionAmount: 2500,
        frequency: 'monthly',
        maxMembers: 4,
        paymentDueDay: 5,
        startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        attributionMode: 'random',
      }),
    ).rejects.toThrow(/non autorisés/);
    const log = await (async () => {
      await demoLogin('u-super');
      return reportService.securityLog();
    })();
    expect(log[0]?.event).toMatchObject({ kind: 'suspicious_input', severity: 'critical' });
    expect(log[0]?.userName).toBe('Moussa Diop');
  }, 15_000);

  it('accepte un nom ordinaire avec apostrophe', async () => {
    await demoLogin('u-p1');
    await expect(authService.updateProfile({ lastName: 'N’Diaye' })).resolves.toBeTruthy();
    await expect(authService.updateProfile({ lastName: "N'Diaye" })).resolves.toBeTruthy();
  }, 10_000);

  it('note un accès refusé à un groupe dont on n’est pas membre', async () => {
    await demoLogin('u-p1');
    await expect(groupService.get('g-thiaroye')).rejects.toThrow();
    expect(await securityKinds()).toContain('access_denied');
  }, 10_000);

  it('ne renvoie jamais les clés secrètes, seulement leur indice', async () => {
    await demoLogin('u-super');
    const settings = await settingsService.get();
    expect(JSON.stringify(settings)).not.toContain('sk_test_51b0e6c3a7f94d28');
    expect(JSON.stringify(settings)).not.toContain('osms_4d1e9b7c2a');
    expect(settings.payment.secretKeyHint).toBe('•••• 4d28');
    // Sans nouvelle clé, l'ancienne est gardée ; avec, elle est remplacée.
    await settingsService.update('payment', settings.payment);
    expect((await settingsService.get()).payment.secretKeyHint).toBe('•••• 4d28');
    await settingsService.update('payment', settings.payment, 'sk_live_nouvelle_9z9z');
    expect((await settingsService.get()).payment.secretKeyHint).toBe('•••• 9z9z');
  }, 15_000);

  it('réservé au super administrateur', async () => {
    await demoLogin('u-admin1');
    await expect(reportService.securityLog()).rejects.toThrow(/super administrateur/);
  }, 10_000);
});

describe('traduction wolof', () => {
  it('remplace les valeurs et traduit les échéances et les mois', () => {
    expect(translate('wo', 'home.hello', { name: 'Awa' })).toBe('Nanga def, Awa');
    expect(translate('fr', 'home.hello', { name: 'Awa' })).toBe('Bonjour Awa');
    const now = new Date('2026-11-04T10:00:00');
    expect(deadlineLabel('2026-11-10T10:00:00', now, 'wo')).toBe('Ci 6 fan');
    expect(deadlineLabel('2026-11-10T10:00:00', now)).toBe('Dans 6 jours');
    expect(monthNameIn('wo', '2026-11-10T10:00:00')).toBe('Nowàmbar');
  });
});
