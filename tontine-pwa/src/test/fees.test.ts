// Frais du service de paiement (PayTech) : payés par le membre, en plus, hors cagnotte.
import { serviceFee } from '@/lib/tontine';
import { authService, groupService, paymentService } from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { db, resetDatabase } from '@/services/mock/db';
import { getSimulatedCheckout } from '@/services/mock/gateway';

describe('frais de paiement', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('arrondit au franc supérieur et ne facture rien sans montant', () => {
    expect(serviceFee(4500, 1.5)).toBe(68); // 67,5 → 68
    expect(serviceFee(10000, 1.5)).toBe(150);
    expect(serviceFee(0, 1.5)).toBe(0);
    expect(serviceFee(4500, 0)).toBe(0);
  });

  it('les ajoute au paiement du membre, sans toucher au montant de la tontine', async () => {
    await demoLogin('u-p1');
    const famille = (await groupService.listMine()).find((o) => o.group.id === 'g-famille');
    if (!famille?.currentRound) throw new Error('Tour en cours attendu.');
    const fee = serviceFee(famille.myAmountDue, db.settings.payment.feePercent);
    expect(famille.myServiceFee).toBe(fee);

    const { paymentId } = await paymentService.initiatePayment({
      roundId: famille.currentRound.id,
      method: 'wave',
    });
    const payment = db.payments.find((p) => p.id === paymentId);
    expect(payment?.amount).toBe(famille.myAmountDue); // la tontine
    expect(payment?.serviceFeeAmount).toBe(fee); // le prestataire
    // La page de paiement débite les deux.
    expect((await getSimulatedCheckout(paymentId)).amount).toBe(famille.myAmountDue + fee);
  }, 15_000);
});
