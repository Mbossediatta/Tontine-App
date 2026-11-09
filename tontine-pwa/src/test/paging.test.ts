// Listes paginées du super admin (Transactions, Journal d'audit, Sécurité) : pages
// enchaînées sans doublon ni oubli, filtres et totaux calculés sur toute la liste.
import { fetchAllPages } from '@/features/admin/components/useServerList';
import { adminService, authService, reportService } from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { resetDatabase } from '@/services/mock/db';

describe('listes paginées', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
    await demoLogin('u-super');
  });

  it('enchaîne les pages du journal sans doublon ni oubli', async () => {
    const all = await reportService.auditLog();
    const first = await reportService.auditPage({}, undefined, 3);
    expect(first.rows).toHaveLength(Math.min(3, all.length));
    expect(first.summary?.total).toBe(all.length);
    const second = await reportService.auditPage({}, first.next, 3);
    expect(second.summary).toBeUndefined();
    const ids = [...first.rows, ...second.rows].map(({ entry }) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    const everything = await fetchAllPages((cursor, limit) =>
      reportService.auditPage({}, cursor, limit),
    );
    expect(everything.map(({ entry }) => entry.id).sort()).toEqual(
      all.map(({ entry }) => entry.id).sort(),
    );
  });

  it('filtre les transactions et calcule les totaux sur toute la sélection', async () => {
    const all = await adminService.listTransactions();
    const page = await adminService.transactionsPage({ status: 'paid' }, undefined, 2);
    const paid = all.filter(({ payment }) => payment.status === 'paid');
    expect(page.summary?.total).toBe(paid.length);
    expect(page.summary?.paidAmount).toBe(
      paid.reduce((sum, { payment }) => sum + payment.amount, 0),
    );
    expect(page.rows.every(({ payment }) => payment.status === 'paid')).toBe(true);
    expect(page.next !== undefined).toBe(paid.length > 2);
  });

  it('filtre le journal de sécurité et refuse les autres comptes', async () => {
    const page = await reportService.securityPage({ kinds: ['admin_login'] });
    expect(page.rows.every(({ event }) => event.kind === 'admin_login')).toBe(true);
    const summary = await reportService.securitySummary();
    expect(summary.all).toBeGreaterThanOrEqual(summary.login);

    await authService.logout();
    await demoLogin('u-admin1');
    await expect(reportService.securityPage({})).rejects.toThrow(/super administrateur/);
  });
});
