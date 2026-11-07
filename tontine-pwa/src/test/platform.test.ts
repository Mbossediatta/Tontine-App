import { createElement } from 'react';
import { addMonths, startOfMonth, subMonths } from 'date-fns';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';
import { useAuthStore } from '@/hooks/useAuth';
import {
  authService,
  communicationService,
  disputeService,
  financeService,
  reportService,
  settingsService,
} from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { resetDatabase } from '@/services/mock/db';

describe('rubriques du super administrateur', () => {
  beforeEach(async () => {
    resetDatabase();
    await demoLogin('u-super');
  });

  it('envoie une annonce dans l’application, ou aussi par SMS, avec une trace d’audit', async () => {
    const smsBefore = (await communicationService.smsStats(30)).count;
    const count = await communicationService.announce(
      { kind: 'admins' },
      'Maintenance',
      'La plateforme sera indisponible dimanche.',
    );
    expect(count).toBeGreaterThan(0);
    // Notification push seulement : aucun SMS n'est compté.
    expect((await communicationService.smsStats(30)).count).toBe(smsBefore);
    // Canal « SMS » : un SMS par destinataire, en plus de la notification.
    const bySms = await communicationService.announce(
      { kind: 'admins' },
      'Maintenance',
      'Rappel : indisponible dimanche.',
      'sms',
    );
    expect((await communicationService.smsStats(30)).count).toBe(smsBefore + bySms);
    expect(
      (await reportService.auditLog()).some(({ entry }) => entry.action === 'announcement_sent'),
    ).toBe(true);
  }, 10_000);

  it('enregistre les paramètres et trace la modification', async () => {
    const settings = await settingsService.get();
    await settingsService.update('rules', { ...settings.rules, graceDays: 2 });
    expect((await settingsService.get()).rules.graceDays).toBe(2);
    expect(
      (await reportService.auditLog()).some(({ entry }) => entry.action === 'settings_updated'),
    ).toBe(true);
  }, 10_000);

  it('modifier les conditions crée une version à accepter de nouveau par chacun', async () => {
    const settings = await settingsService.get();
    await settingsService.update('app', { ...settings.app, name: 'Calebasse' });
    expect((await authService.legalTerms()).version).toBe(1);
    await settingsService.update('app', { ...settings.app, termsText: 'Nouvelles conditions.' });
    expect(await authService.legalTerms()).toMatchObject({
      version: 2,
      termsText: 'Nouvelles conditions.',
    });
    expect(await authService.termsStatus()).toEqual({ current: 2, accepted: 1 });
    await expect(authService.acceptTerms(1)).rejects.toThrow(/mises à jour/);
    await authService.acceptTerms(2);
    expect(await authService.termsStatus()).toEqual({ current: 2, accepted: 2 });
  }, 10_000);

  it('permet de bloquer puis débloquer un versement non payé', async () => {
    const payout = (await financeService.payouts()).find((row) => row.stage !== 'paid');
    expect(payout).toBeDefined();
    if (!payout) return;
    await financeService.blockPayout(payout.round.id, 'Vérification complémentaire');
    expect(
      (await financeService.payouts()).find((row) => row.round.id === payout.round.id)?.stage,
    ).toBe('blocked');
    await financeService.unblockPayout(payout.round.id);
    expect(
      (await financeService.payouts()).find((row) => row.round.id === payout.round.id)?.stage,
    ).not.toBe('blocked');
  }, 10_000);

  it('un membre ouvre une réclamation, le super admin la reçoit dans les litiges', async () => {
    await demoLogin('u-p1');
    await expect(
      disputeService.open({ groupId: 'g-famille', kind: 'other', amount: 0, description: 'ok' }),
    ).rejects.toThrow(/quelques mots/);
    await disputeService.open({
      groupId: 'g-famille',
      kind: 'payout_not_received',
      amount: 50_000,
      method: 'wave',
      providerRef: 'TX-9',
      description: 'Ma cagnotte est marquée envoyée mais je n’ai rien reçu.',
    });
    const [mine] = await disputeService.listMine();
    expect(mine?.dispute).toMatchObject({ kind: 'payout_not_received', status: 'open' });
    expect(mine?.groupName).toBe('Tontine Famille');
    await demoLogin('u-super');
    expect((await disputeService.list()).some((d) => d.dispute.id === mine?.dispute.id)).toBe(true);
  }, 10_000);

  it('charge les litiges et produit un rapport borné aux dates sélectionnées', async () => {
    const disputes = await disputeService.list();
    expect(disputes.length).toBeGreaterThan(0);
    const from = startOfMonth(subMonths(new Date(), 5)).toISOString();
    const to = startOfMonth(addMonths(new Date(), 1)).toISOString();
    const report = await reportService.report(from, to);
    expect(report.monthly.length).toBe(7);
    expect(report.byGroup.length).toBeGreaterThan(0);
  }, 10_000);

  it('ouvre chacune des rubriques du menu super administrateur', async () => {
    const { user } = await authService.getSession();
    if (!user) throw new Error('Session super administrateur attendue.');
    useAuthStore.getState().setUser(user);
    const pages = [
      ['/admin/transactions', 'Transactions'],
      ['/admin/versements', 'Versements'],
      ['/admin/litiges', 'Litiges et remboursements'],
      ['/admin/annonces', 'Notifications et annonces'],
      ['/admin/rapports', 'Rapports et statistiques'],
      ['/admin/audit', 'Journal d’audit'],
      ['/admin/parametres', 'Paramètres'],
    ] as const;
    for (const [path, title] of pages) {
      const router = createMemoryRouter(routes, {
        initialEntries: [path],
        future: { v7_relativeSplatPath: true },
      });
      const rendered = render(
        createElement(AppProviders, null, createElement(RouterProvider, { router })),
      );
      expect(
        await screen.findByRole('heading', { name: title }, { timeout: 8000 }),
      ).toBeInTheDocument();
      rendered.unmount();
    }
  }, 15_000);
});
