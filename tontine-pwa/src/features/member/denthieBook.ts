// Carnet électronique d'un Denthie : lignes de versements et document PDF (A4, plusieurs
// pages si besoin, logo du groupe s'il y en a un).
import { isPeriod } from '@/lib/denthie';
import { formatAmount, formatDate, formatPhone, paymentMethodLabel } from '@/lib/format';
import { buildPagedPdf, jpegFromDataUrl, type PdfItem, type Rgb } from '@/lib/pdf';
import type { Group, PaymentHistoryItem, PaymentMethod, Round } from '@/types';

export interface BookLine {
  paymentId: string;
  paidAt?: string;
  /** Numéro de la période (1 pour la première). */
  period: number;
  method: PaymentMethod;
  providerRef?: string;
  saved: number;
  penalty: number;
  fee: number;
}

export interface BookTotals {
  saved: number;
  penalties: number;
  fees: number;
}

/** Versements confirmés d'une personne sur les périodes du cycle en cours, du plus ancien au plus récent. */
export function bookLines(
  group: Pick<Group, 'currentCycle'>,
  rounds: Round[],
  payments: PaymentHistoryItem[],
): { lines: BookLine[]; totals: BookTotals } {
  const periods = rounds
    .filter((round) => isPeriod(round) && round.cycle === group.currentCycle)
    .sort((a, b) => a.number - b.number);
  const periodOf = new Map(periods.map((round, index) => [round.id, index + 1]));
  const lines = payments
    .filter(({ payment }) => payment.status === 'paid' && periodOf.has(payment.roundId))
    .sort((a, b) => (a.payment.paidAt ?? '').localeCompare(b.payment.paidAt ?? ''))
    .map(({ payment }) => ({
      paymentId: payment.id,
      paidAt: payment.paidAt,
      period: periodOf.get(payment.roundId) ?? 0,
      method: payment.method,
      providerRef: payment.providerRef,
      saved: payment.contributionAmount ?? 0,
      penalty: payment.latePenaltyAmount ?? 0,
      fee: payment.membershipFeeAmount ?? 0,
    }));
  const totals = lines.reduce(
    (sum, line) => ({
      saved: sum.saved + line.saved,
      penalties: sum.penalties + line.penalty,
      fees: sum.fees + line.fee,
    }),
    { saved: 0, penalties: 0, fees: 0 },
  );
  return { lines, totals };
}

export interface BookDocument {
  groupName: string;
  groupDescription?: string;
  /** Photo ou logo du groupe (data URL JPEG), facultatif. */
  photoUrl?: string;
  cycle: number;
  holderName: string;
  holderPhone?: string;
  facts: Array<[string, string]>;
  lines: BookLine[];
  totals: BookTotals;
}

// Couleurs de la charte (comme les reçus).
const BLUE_700: Rgb = [0x1e, 0x5a, 0xa8];
const BLUE_900: Rgb = [0x12, 0x40, 0x7a];
const GREEN_100: Rgb = [0xe8, 0xf8, 0xef];
const GREEN_700: Rgb = [0x1f, 0x7a, 0x47];
const INK: Rgb = [0x1b, 0x27, 0x33];
const MUTED: Rgb = [0x5b, 0x6b, 0x7a];
const LINE: Rgb = [0xdc, 0xe5, 0xee];
const WHITE: Rgb = [0xff, 0xff, 0xff];

// A4 portrait.
const WIDTH = 595;
const HEIGHT = 842;
const MARGIN = 40;
const ROW = 18;
const BOTTOM = HEIGHT - 70;
const COLUMNS = { date: MARGIN, period: 140, method: 200, amount: 470 };

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  color: Rgb,
  bold = false,
): PdfItem {
  return { kind: 'text', x, y, text: value, size, color, bold };
}

function tableHeader(y: number): PdfItem[] {
  return [
    text(COLUMNS.date, y, 'Date', 9, MUTED, true),
    text(COLUMNS.period, y, 'Période', 9, MUTED, true),
    text(COLUMNS.method, y, 'Moyen · référence', 9, MUTED, true),
    text(COLUMNS.amount, y, 'Épargné', 9, MUTED, true),
    { kind: 'line', x1: MARGIN, y1: y + 6, x2: WIDTH - MARGIN, y2: y + 6, width: 0.8, color: LINE },
  ];
}

/** Octets du carnet en PDF. */
export function buildBookPdf(doc: BookDocument): Uint8Array {
  const pages: PdfItem[][] = [];
  let page: PdfItem[] = [
    { kind: 'rect', x: 0, y: 0, width: WIDTH, height: 110, color: BLUE_700 },
    text(MARGIN, 46, 'Calebasse de l’Espoir', 22, WHITE, true),
    text(MARGIN, 74, `Carnet Denthie · cycle ${doc.cycle}`, 13, WHITE),
  ];
  const logo = jpegFromDataUrl(doc.photoUrl);
  if (logo && logo.pixelWidth > 0 && logo.pixelHeight > 0) {
    const scale = Math.min(76 / logo.pixelWidth, 76 / logo.pixelHeight);
    const width = logo.pixelWidth * scale;
    const height = logo.pixelHeight * scale;
    page.push({
      kind: 'image',
      image: logo,
      x: WIDTH - MARGIN - width,
      y: 17 + (76 - height) / 2,
      width,
      height,
    });
  }
  page.push(text(MARGIN, 144, clip(doc.groupName, 60), 18, INK, true));
  let y = 144;
  if (doc.groupDescription) {
    y += 18;
    page.push(text(MARGIN, y, clip(doc.groupDescription, 100), 10, MUTED));
  }
  y += 16;
  page.push(
    { kind: 'rect', x: MARGIN, y, width: WIDTH - MARGIN * 2, height: 56, color: GREEN_100 },
    text(MARGIN + 14, y + 20, 'Titulaire', 10, MUTED),
    text(MARGIN + 14, y + 42, clip(doc.holderName, 50), 15, INK, true),
  );
  if (doc.holderPhone) {
    page.push(text(330, y + 42, formatPhone(doc.holderPhone), 12, INK));
  }
  y += 82;
  doc.facts.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? MARGIN : 320;
    const rowY = y + Math.floor(index / 2) * 34;
    page.push(text(x, rowY, label, 9, MUTED), text(x, rowY + 14, clip(value, 40), 11, INK, true));
  });
  y += Math.ceil(doc.facts.length / 2) * 34 + 14;

  page.push(text(MARGIN, y, 'Mes versements', 13, INK, true));
  y += 22;
  page.push(...tableHeader(y));
  y += ROW + 4;
  if (doc.lines.length === 0) {
    page.push(text(MARGIN, y, 'Aucun versement pour l’instant.', 10, MUTED));
    y += ROW;
  }
  for (const line of doc.lines) {
    if (y > BOTTOM) {
      pages.push(page);
      page = [...tableHeader(60)];
      y = 60 + ROW + 4;
    }
    const extra = [
      line.penalty ? `pénalité ${formatAmount(line.penalty)}` : '',
      line.fee ? `adhésion ${formatAmount(line.fee)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    page.push(
      text(COLUMNS.date, y, line.paidAt ? formatDate(line.paidAt) : '—', 10, INK),
      text(COLUMNS.period, y, String(line.period), 10, INK),
      text(
        COLUMNS.method,
        y,
        clip(
          [paymentMethodLabel(line.method), line.providerRef, extra ? `(${extra})` : '']
            .filter(Boolean)
            .join(' · '),
          52,
        ),
        9,
        MUTED,
      ),
      text(COLUMNS.amount, y, formatAmount(line.saved), 10, INK, true),
      {
        kind: 'line',
        x1: MARGIN,
        y1: y + 6,
        x2: WIDTH - MARGIN,
        y2: y + 6,
        width: 0.4,
        color: LINE,
      },
    );
    y += ROW;
  }

  if (y + 80 > BOTTOM) {
    pages.push(page);
    page = [];
    y = 60;
  }
  y += 16;
  page.push(
    text(MARGIN, y, 'Total épargné', 13, INK, true),
    text(COLUMNS.amount - 30, y, formatAmount(doc.totals.saved), 15, GREEN_700, true),
  );
  if (doc.totals.penalties > 0) {
    y += 18;
    page.push(
      text(MARGIN, y, 'Pénalités payées (non épargnées)', 10, MUTED),
      text(COLUMNS.amount, y, formatAmount(doc.totals.penalties), 10, MUTED),
    );
  }
  if (doc.totals.fees > 0) {
    y += 18;
    page.push(
      text(MARGIN, y, 'Frais d’adhésion payés', 10, MUTED),
      text(COLUMNS.amount, y, formatAmount(doc.totals.fees), 10, MUTED),
    );
  }
  pages.push(page);

  const edited = formatDate(new Date());
  pages.forEach((items, index) => {
    items.push(
      text(
        MARGIN,
        HEIGHT - 34,
        `Édité le ${edited} par Calebasse de l’Espoir · seuls les paiements confirmés y figurent · page ${index + 1}/${pages.length}`,
        8,
        BLUE_900,
      ),
    );
  });
  return buildPagedPdf(WIDTH, HEIGHT, pages);
}

/** « carnet-denthie-famille-awa-fall.pdf » */
export function bookFileName(groupName: string, holderName: string): string {
  const safe = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  return `carnet-${safe(groupName)}-${safe(holderName)}.pdf`;
}
