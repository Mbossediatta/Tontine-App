// Parcours de bout en bout sur les données simulées (critères d'acceptation du cahier des charges).
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';
import { useAuthStore } from '@/hooks/useAuth';
import { adminService, authService, groupService, paymentService } from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { applyPendingConfirmations, completeSimulatedCheckout } from '@/services/mock/gateway';
import { resetDatabase } from '@/services/mock/db';

const TIMEOUT = { timeout: 5000 };

async function loginAs(userId: string) {
  await demoLogin(userId);
  const { user } = await authService.getSession();
  useAuthStore.getState().setUser(user);
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, {
    initialEntries: [path],
    future: { v7_relativeSplatPath: true },
  });
  return render(
    <AppProviders>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>,
  );
}

describe('parcours', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('présente la connexion avec le logo de l’application et un texte court', async () => {
    useAuthStore.getState().setUser(null);
    renderAt('/connexion?nouveau=1');
    expect(await screen.findByRole('heading', { name: 'Connexion' }, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByAltText('Calebasse de l’Espoir')).toBeInTheDocument();
    expect(
      screen.getByText('Accédez à vos groupes et suivez vos cotisations.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Numéro de téléphone')).toBeInTheDocument();
  }, 10_000);

  it('accueil participant : montants dus et prochain tour', async () => {
    await loginAs('u-p1');
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'Bonjour Awa' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(await screen.findAllByText(/Tontine Famille/, {}, TIMEOUT)).not.toHaveLength(0);
    expect(screen.getByText(/Prochaine cotisation|Tu es à jour/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Groupes' }).length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole('link', { name: 'Payer' })
        .every((link) => link.getAttribute('href') === '/payer'),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('link', { name: 'Historique' })
        .every((link) => link.getAttribute('href') === '/historique'),
    ).toBe(true);
  }, 10_000);

  it('ouvre le parcours de paiement et l’historique membre depuis les routes dédiées', async () => {
    await loginAs('u-p1');
    renderAt('/payer');
    expect(
      await screen.findByRole('heading', { name: /Quelle cotisation \?|Payer avec/ }, TIMEOUT),
    ).toBeInTheDocument();
    if (!screen.queryByText('Wave')) {
      fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    }
    expect(await screen.findByText('Wave', {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText('Orange Money')).toBeInTheDocument();
  }, 10_000);

  it('affiche l’historique membre et son filtre de période', async () => {
    await loginAs('u-p1');
    renderAt('/historique');
    expect(await screen.findByRole('heading', { name: 'Historique' }, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByLabelText('Période')).toBeInTheDocument();
    expect(screen.getByLabelText('Groupe')).toBeInTheDocument();
  }, 10_000);

  it('indique la communauté dans la liste des groupes du membre', async () => {
    await loginAs('u-p1');
    renderAt('/groupes');
    expect((await screen.findAllByText(/Ouakam ·/, {}, TIMEOUT)).length).toBeGreaterThan(0);
  }, 10_000);

  it('ouvre le calendrier et la liste des membres du groupe', async () => {
    await loginAs('u-p1');
    renderAt('/groupes/g-famille');
    expect(
      await screen.findByRole('heading', { name: 'Tontine Famille' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Calendrier de passage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Membres' })).toBeInTheDocument();
  }, 10_000);

  it('le paiement simulé passe le statut à « payé » partout', async () => {
    await loginAs('u-p1');
    const before = await groupService.get('g-famille');
    expect(before.myStatus).toBe('pending');
    const round = before.currentRound;
    if (!round) throw new Error('tour attendu');
    const { paymentId } = await paymentService.initiatePayment({
      roundId: round.id,
      method: 'wave',
    });
    await completeSimulatedCheckout(paymentId, true);
    applyPendingConfirmations(Date.now() + 10_000);
    const after = await groupService.get('g-famille');
    expect(after.myStatus).toBe('paid');
    expect(after.paidCount).toBe(before.paidCount + 1);
    const mine = await groupService.listMine();
    expect(mine.find((g) => g.group.id === 'g-famille')?.myStatus).toBe('paid');
  }, 15_000);

  it('un administrateur ne voit pas les groupes des autres', async () => {
    await loginAs('u-admin2');
    const managed = await groupService.listManaged();
    expect(managed.map((g) => g.group.name)).toEqual([
      'Collègues du bureau',
      'Tontine Thiaroye',
      'Entraide Pikine',
    ]);
    await expect(groupService.get('g-famille')).rejects.toThrow();
  }, 10_000);

  it('affiche la gestion des communautés au super administrateur', async () => {
    await loginAs('u-super');
    renderAt('/admin/communautes');
    expect(
      await screen.findByRole('heading', { name: 'Communautés' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(await screen.findByText('Ouakam', {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText('AFP')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle communauté' }));
    fireEvent.change(screen.getByLabelText('Nom de la communauté'), {
      target: { value: 'Association Soleil' },
    });
    const adminCheckboxes = await screen.findAllByRole('checkbox', {}, TIMEOUT);
    const firstAdminCheckbox = adminCheckboxes[0];
    if (!firstAdminCheckbox) throw new Error('Un administrateur doit être disponible.');
    fireEvent.click(firstAdminCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Créer la communauté' }));
    expect(await screen.findByText('Association Soleil', {}, TIMEOUT)).toBeInTheDocument();
  }, 10_000);

  it('un co-admin gère le groupe mais ne peut pas le supprimer', async () => {
    await loginAs('u-admin1'); // co-admin de « Collègues du bureau »
    await expect(
      groupService.update('g-bureau', { description: 'Nouvelle' }),
    ).resolves.toBeTruthy();
    await expect(groupService.remove('g-bureau')).rejects.toThrow(/propriétaire/);
  }, 10_000);

  it('seul le super administrateur accède à /admin/administrateurs', async () => {
    await loginAs('u-admin1');
    renderAt('/admin/administrateurs');
    expect(await screen.findByText('Accès refusé', {}, TIMEOUT)).toBeInTheDocument();
  }, 10_000);

  it('le super administrateur voit la liste des administrateurs', async () => {
    await loginAs('u-super');
    renderAt('/admin/administrateurs');
    expect(await screen.findByText('Moussa Diop', {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText('Fatou Ndiaye')).toBeInTheDocument();
  }, 10_000);

  it('montant, fréquence et membres sont verrouillés après le démarrage', async () => {
    await loginAs('u-admin1');
    await expect(groupService.update('g-famille', { contributionAmount: 9000 })).rejects.toThrow(
      /verrouillés/,
    );
  }, 10_000);

  it('affiche le tableau de bord administrateur', async () => {
    await loginAs('u-admin1');
    renderAt('/admin');
    expect(await screen.findByText('Mes groupes actifs', {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText('Membres dans mes groupes actifs')).toBeInTheDocument();
    expect(screen.getByText('À traiter')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Vue d’ensemble de mes groupes' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Prochain versement')).toBeInTheDocument();
    expect(screen.getByText('Actions rapides')).toBeInTheDocument();
    const navigation = screen.getAllByRole('navigation', { name: 'Navigation principale' });
    expect(screen.getAllByRole('link', { name: 'Mes groupes' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Cotisations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cotis.' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Créer un groupe|Créer/ }).length).toBeGreaterThan(
      0,
    );
    expect(navigation.every((menu) => !menu.querySelector('a[href="/profil"]'))).toBe(true);
    expect(screen.getByRole('link', { name: /Notifications/ })).toBeInTheDocument();
  }, 10_000);

  it('un administrateur retrouve ses groupes gérés dans la rubrique dédiée', async () => {
    await loginAs('u-admin1');
    renderAt('/admin/mes-groupes');
    expect(
      await screen.findByRole('heading', { name: 'Mes groupes' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Tontine Famille' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collègues du bureau' })).toBeInTheDocument();
    expect(await screen.findAllByText(/Ouakam/, {}, TIMEOUT)).not.toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Tontine Thiaroye' })).not.toBeInTheDocument();
  }, 10_000);

  it('le menu Cotisations ouvre le suivi des groupes gérés', async () => {
    await loginAs('u-admin1');
    renderAt('/admin/cotisations');
    expect(
      await screen.findByRole('heading', { name: 'Suivi des cotisations' }, TIMEOUT),
    ).toBeInTheDocument();
    const groupPaymentLinks = await screen.findAllByRole(
      'link',
      { name: /Suivre les cotisations/ },
      TIMEOUT,
    );
    expect(groupPaymentLinks.map((link) => link.getAttribute('href'))).toContain(
      '/admin/groupes/g-famille?onglet=paiements',
    );
  }, 10_000);

  it('adapte l’espace membre de l’admin au layout admin sans cloche en double', async () => {
    await loginAs('u-admin1');
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'Espace membre' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByRole('main').className).toContain('max-w-admin');
    expect(screen.getAllByRole('link', { name: /Notifications/ })).toHaveLength(1);
  }, 10_000);

  it('affiche le tableau de bord du super administrateur', async () => {
    await loginAs('u-super');
    renderAt('/admin');
    expect(await screen.findByText('Tableau de bord Superadmin', {}, TIMEOUT)).toBeInTheDocument();
    expect(await screen.findByText('Alertes à traiter', {}, TIMEOUT)).toBeInTheDocument();
    // « Journal d’audit » figure aussi dans le menu : on vise le titre de la carte.
    expect(screen.getByRole('heading', { name: 'Journal d’audit' })).toBeInTheDocument();
    expect(screen.getByText('Transactions récentes')).toBeInTheDocument();
  }, 10_000);

  it('vue plateforme : statuts des groupes, échec du jour et recouvrement par admin', async () => {
    await loginAs('u-super');
    const data = await adminService.superDashboard();
    expect(data.groups).toMatchObject({ active: 2, suspended: 1, finished: 1, draft: 1 });
    expect(data.monthly).toHaveLength(6);
    expect(data.alerts.some((a) => a.id === 'failed-today')).toBe(true);
    const fatou = data.admins.find((a) => a.user.id === 'u-admin2');
    expect(fatou?.groups.map((g) => g.id)).toContain('g-thiaroye');
    expect(fatou?.recoveryRate).toBe(100); // tours échus de Thiaroye tous payés
  }, 10_000);

  it('le profil du super administrateur masque les rubriques de participant', async () => {
    await loginAs('u-super');
    renderAt('/profil');
    expect(await screen.findByText('Super administrateur', {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByText('Recevoir la cagnotte')).not.toBeInTheDocument();
    expect(screen.queryByText(/Supprimer mon compte/)).not.toBeInTheDocument();
  }, 10_000);

  it('les actions sensibles sont inscrites au journal d’audit', async () => {
    await loginAs('u-super');
    await adminService.suspend('u-admin2');
    const { audit } = await adminService.superDashboard();
    expect(audit[0]?.entry.action).toBe('admin_suspended');
    expect(audit[0]?.actorName).toBe('Aminata Sow');
  }, 10_000);
});
