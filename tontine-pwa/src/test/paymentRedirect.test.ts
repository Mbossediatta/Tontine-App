// Aller-retour vers la page de paiement : pas de PIN redemandé au retour, mais
// seulement pendant un paiement récent et jusqu'à l'affichage du résultat.
import {
  clearPaymentRedirect,
  isReturningFromPayment,
  markPaymentRedirect,
} from '@/lib/paymentRedirect';

describe('retour de la page de paiement', () => {
  beforeEach(() => clearPaymentRedirect());

  it('sans paiement en cours, c’est une relance normale', () => {
    expect(isReturningFromPayment()).toBe(false);
  });

  it('reconnaît un retour de paiement récent', () => {
    markPaymentRedirect();
    expect(isReturningFromPayment()).toBe(true);
  });

  it('ignore un paiement abandonné depuis plus de 20 minutes', () => {
    markPaymentRedirect();
    expect(isReturningFromPayment(Date.now() + 21 * 60 * 1000)).toBe(false);
  });

  it('une fois le résultat affiché, la marque disparaît', () => {
    markPaymentRedirect();
    clearPaymentRedirect();
    expect(isReturningFromPayment()).toBe(false);
  });
});
