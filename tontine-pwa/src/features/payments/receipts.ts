// Reçus PDF : cotisation payée et cagnotte reçue.
import { buildPdf, downloadPdf, type PdfItem, type Rgb } from '@/lib/pdf';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatPhone,
  paymentMethodLabel,
} from '@/lib/format';
import type { PaymentMethod, PayoutMethod } from '@/types';

// Couleurs de la charte (DESIGN-UI.md, section 2) pour le document imprimé.
const BLUE_700: Rgb = [0x1e, 0x5a, 0xa8];
const BLUE_900: Rgb = [0x12, 0x40, 0x7a];
const GREEN_100: Rgb = [0xe8, 0xf8, 0xef];
const GREEN_700: Rgb = [0x1f, 0x7a, 0x47];
const INK: Rgb = [0x1b, 0x27, 0x33];
const MUTED: Rgb = [0x5b, 0x6b, 0x7a];
const LINE: Rgb = [0xdc, 0xe5, 0xee];
const WHITE: Rgb = [0xff, 0xff, 0xff];

// Format A5 portrait.
const WIDTH = 420;
const HEIGHT = 595;
const MARGIN = 32;

interface ReceiptLayout {
  title: string;
  number: string;
  amountLabel: string;
  amount: number;
  rows: Array<[string, string]>;
  note: string;
}

function layout({ title, number, amountLabel, amount, rows, note }: ReceiptLayout): PdfItem[] {
  const items: PdfItem[] = [
    { kind: 'rect', x: 0, y: 0, width: WIDTH, height: 92, color: BLUE_700 },
    {
      kind: 'text',
      x: MARGIN,
      y: 40,
      text: 'Calebasse de l’Espoir',
      size: 20,
      bold: true,
      color: WHITE,
    },
    { kind: 'text', x: MARGIN, y: 66, text: title, size: 13, color: WHITE },
    { kind: 'text', x: MARGIN, y: 124, text: `Reçu n° ${number}`, size: 10, color: MUTED },
    {
      kind: 'text',
      x: MARGIN,
      y: 140,
      text: `Émis le ${formatDateTime(new Date())}`,
      size: 10,
      color: MUTED,
    },
    { kind: 'rect', x: MARGIN, y: 158, width: WIDTH - MARGIN * 2, height: 70, color: GREEN_100 },
    { kind: 'text', x: MARGIN + 16, y: 182, text: amountLabel, size: 11, color: INK },
    {
      kind: 'text',
      x: MARGIN + 16,
      y: 212,
      text: formatAmount(amount),
      size: 24,
      bold: true,
      color: GREEN_700,
    },
  ];
  let y = 262;
  for (const [label, value] of rows) {
    items.push(
      { kind: 'text', x: MARGIN, y, text: label, size: 10, color: MUTED },
      { kind: 'text', x: 170, y, text: value, size: 11, bold: true, color: INK },
      {
        kind: 'line',
        x1: MARGIN,
        y1: y + 10,
        x2: WIDTH - MARGIN,
        y2: y + 10,
        width: 0.5,
        color: LINE,
      },
    );
    y += 28;
  }
  items.push(
    { kind: 'text', x: MARGIN, y: HEIGHT - 52, text: note, size: 9, color: MUTED },
    {
      kind: 'text',
      x: MARGIN,
      y: HEIGHT - 36,
      text: 'Document généré automatiquement par l’application Calebasse de l’Espoir.',
      size: 9,
      color: BLUE_900,
    },
  );
  return items;
}

function safeFileName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export interface PaymentReceiptData {
  paymentId: string;
  payerName: string;
  payerPhone: string;
  groupName: string;
  cycle: number;
  roundNumber: number;
  amount: number;
  method: PaymentMethod;
  providerRef?: string;
  paidAt: string;
}

/** Reçu d'une cotisation payée. */
export function downloadPaymentReceipt(data: PaymentReceiptData): void {
  downloadPdf(buildPaymentReceipt(data), paymentReceiptFileName(data));
}

/** Nom du fichier du reçu : « recu-tontine-famille-tour-3.pdf ». */
export function paymentReceiptFileName(data: PaymentReceiptData): string {
  return `recu-${safeFileName(data.groupName)}-tour-${data.roundNumber}.pdf`;
}

/** Octets du reçu PDF d'une cotisation (pour le télécharger ou le partager). */
export function buildPaymentReceipt(data: PaymentReceiptData): Uint8Array {
  const items = layout({
    title: 'Reçu de cotisation',
    number: data.paymentId.toUpperCase(),
    amountLabel: 'Montant payé',
    amount: data.amount,
    rows: [
      ['Membre', data.payerName],
      ['Téléphone', data.payerPhone ? formatPhone(data.payerPhone) : '—'],
      ['Groupe', data.groupName],
      ['Tour', `Tour ${data.roundNumber} · cycle ${data.cycle}`],
      ['Date du paiement', formatDate(data.paidAt)],
      ['Moyen de paiement', paymentMethodLabel(data.method)],
      ['Référence', data.providerRef ?? '—'],
      ['Statut', 'Payé'],
    ],
    note: 'Ce reçu atteste que la cotisation ci-dessus a été enregistrée comme payée.',
  });
  return buildPdf(WIDTH, HEIGHT, items);
}

export interface PayoutReceiptData {
  roundId: string;
  beneficiaryName: string;
  groupName: string;
  cycle: number;
  roundNumber: number;
  amount: number;
  paidOutAt: string;
  payoutPhone?: string;
  payoutMethod?: PayoutMethod;
}

const PAYOUT_LABELS: Record<PayoutMethod, string> = { wave: 'Wave', orange_money: 'Orange Money' };

/** Attestation de cagnotte reçue. */
export function downloadPayoutReceipt(data: PayoutReceiptData): void {
  const items = layout({
    title: 'Attestation de cagnotte reçue',
    number: data.roundId.toUpperCase(),
    amountLabel: 'Cagnotte reçue',
    amount: data.amount,
    rows: [
      ['Bénéficiaire', data.beneficiaryName],
      ['Groupe', data.groupName],
      ['Tour', `Tour ${data.roundNumber} · cycle ${data.cycle}`],
      ['Date du reversement', formatDate(data.paidOutAt)],
      [
        'Reversée sur',
        data.payoutPhone
          ? `${formatPhone(data.payoutPhone)}${data.payoutMethod ? ` (${PAYOUT_LABELS[data.payoutMethod]})` : ''}`
          : '—',
      ],
    ],
    note: 'Cette attestation confirme le reversement de la cagnotte au bénéficiaire.',
  });
  downloadPdf(
    buildPdf(WIDTH, HEIGHT, items),
    `cagnotte-${safeFileName(data.groupName)}-tour-${data.roundNumber}.pdf`,
  );
}
