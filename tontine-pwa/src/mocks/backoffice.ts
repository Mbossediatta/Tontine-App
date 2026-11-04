// Données de démonstration du back-office : paramètres, litiges, relevé du service
// de paiement et historique des SMS.
import { subDays, subHours } from 'date-fns';
import type {
  Dispute,
  Payment,
  PlatformSettings,
  ProviderEntry,
  SmsKind,
  SmsRecord,
  User,
} from '@/types';

/** Coût d'un SMS chez le fournisseur (FCFA), repris dans les paramètres. */
const SMS_COST = 25;

export function seedSettings(): PlatformSettings {
  return {
    payment: {
      provider: 'PayDunya',
      publicKey: 'pk_test_9f2c7a41d8',
      secretKey: 'sk_test_51b0e6c3a7f94d28',
      feePercent: 1.5,
      mode: 'test',
    },
    rules: {
      graceDays: 0,
      defaultLatePenalty: 500,
      minContribution: 500,
      maxContribution: 500000,
      maxMembers: 50,
    },
    security: { otpValidityMinutes: 10, maxPinAttempts: 5, inactivityLockMinutes: 15 },
    sms: {
      provider: 'Orange SMS API',
      senderName: 'CALEBASSE',
      apiKey: 'osms_4d1e9b7c2a',
      costPerSms: SMS_COST,
    },
    app: {
      name: 'Calebasse de l’Espoir',
      supportPhone: '770100101',
      termsText:
        'En utilisant Calebasse de l’Espoir, vous vous engagez à payer vos cotisations à temps et à respecter l’ordre de passage décidé dans votre groupe.',
      privacyText:
        'Vos données (nom, numéro, paiements) servent uniquement au fonctionnement de vos tontines. Elles ne sont jamais revendues.',
    },
    templates: {
      reminder:
        'Bonjour {prenom}, votre cotisation de {montant} pour « {groupe} » est à payer avant le {date}.',
      late: 'Bonjour {prenom}, votre cotisation pour « {groupe} » est en retard. Montant dû : {montant}.',
      payment: 'Merci {prenom} ! Votre paiement de {montant} pour « {groupe} » est bien reçu.',
      payout:
        'Bonne nouvelle {prenom} : la cagnotte de {montant} de « {groupe} » vous a été versée.',
    },
  };
}

/**
 * Relevé du service de paiement : chaque paiement en ligne réussi y figure, plus un
 * débit que l'application n'a jamais enregistré (Babacar Thiam, objet d'un litige).
 */
export function seedProviderLedger(payments: Payment[], users: User[], now: Date): ProviderEntry[] {
  const phoneOf = (userId: string) => users.find((u) => u.id === userId)?.phone ?? '';
  const entries = payments
    .filter((p) => p.status === 'paid' && p.method !== 'cash' && p.providerRef && p.paidAt)
    .map((p) => ({
      ref: p.providerRef ?? '',
      phone: phoneOf(p.userId),
      amount: p.amount,
      at: p.paidAt ?? '',
    }));
  entries.push({
    ref: 'PD-60920',
    phone: phoneOf('u-p10'),
    amount: 10000,
    at: subHours(now, 26).toISOString(),
  });
  return entries;
}

/** Trois réclamations à des stades différents, pour montrer le suivi. */
export function seedDisputes(now: Date): Dispute[] {
  const at = (date: Date) => date.toISOString();
  return [
    {
      id: 'dsp-1',
      userId: 'u-p10',
      groupId: 'g-thiaroye',
      roundId: 'r-g-thiaroye-6',
      providerRef: 'PD-60920',
      method: 'orange_money',
      kind: 'debited_not_recorded',
      description:
        'J’ai payé 10 000 F par Orange Money hier, le montant a été débité mais l’application affiche toujours « échoué ».',
      amount: 10000,
      status: 'open',
      createdAt: at(subHours(now, 20)),
      history: [{ at: at(subHours(now, 20)), actorId: 'u-p10', text: 'Réclamation envoyée' }],
    },
    {
      id: 'dsp-2',
      userId: 'u-p3',
      groupId: 'g-famille',
      paymentId: 'p-dup-u-p3',
      kind: 'double_payment',
      description: 'J’ai appuyé deux fois sur « Payer » et j’ai été débitée deux fois de 4 500 F.',
      amount: 4500,
      status: 'in_progress',
      createdAt: at(subDays(now, 2)),
      history: [
        { at: at(subDays(now, 2)), actorId: 'u-p3', text: 'Réclamation envoyée' },
        { at: at(subDays(now, 1)), actorId: 'u-super', text: 'Prise en charge' },
      ],
    },
    {
      id: 'dsp-3',
      userId: 'u-p5',
      groupId: 'g-famille',
      kind: 'wrong_amount',
      description: 'Une pénalité m’a été comptée alors que j’avais payé avant la date limite.',
      amount: 500,
      status: 'resolved',
      refund: { amount: 500, validatedAt: at(subDays(now, 6)), validatedBy: 'u-super' },
      createdAt: at(subDays(now, 9)),
      history: [
        { at: at(subDays(now, 9)), actorId: 'u-p5', text: 'Réclamation envoyée' },
        { at: at(subDays(now, 8)), actorId: 'u-super', text: 'Prise en charge' },
        { at: at(subDays(now, 6)), actorId: 'u-super', text: 'Remboursement de 500 FCFA validé' },
      ],
    },
  ];
}

/** SMS des 30 derniers jours : codes de connexion, rappels, confirmations, versements. */
export function seedSms(users: User[], now: Date): SmsRecord[] {
  const kinds: SmsKind[] = ['otp', 'reminder', 'reminder', 'payment', 'otp', 'payout', 'reminder'];
  const phones = users.map((u) => u.phone);
  return Array.from({ length: 64 }, (_, i) => ({
    id: `sms-${i + 1}`,
    phone: phones[i % phones.length] ?? '',
    kind: kinds[i % kinds.length] ?? 'otp',
    // Réparti sur 30 jours, plus récent en dernier.
    at: subHours(now, (64 - i) * 11).toISOString(),
    cost: SMS_COST,
  }));
}
