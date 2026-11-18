import { jpegFromDataUrl } from '@/lib/pdf';
import type { PaymentHistoryItem, Round } from '@/types';
import { bookFileName, bookLines, buildBookPdf } from './denthieBook';

// En-tête JPEG minimal : SOI, puis SOF0 (hauteur 2, largeur 3, 3 composantes).
const TINY_JPEG = `data:image/jpeg;base64,${btoa(
  String.fromCharCode(
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x02,
    0x00,
    0x03,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ),
)}`;

function round(id: string, number: number, purpose: Round['purpose'] = 'turn'): Round {
  return {
    id,
    groupId: 'g',
    number,
    openDate: '2026-11-01',
    dueDate: '2026-11-05',
    beneficiaryId: '',
    potAmount: 0,
    status: 'paid_out',
    cycle: 1,
    purpose,
  };
}

function paid(id: string, roundId: string, day: number, extra = {}): PaymentHistoryItem {
  return {
    payment: {
      id,
      roundId,
      userId: 'u',
      amount: 10000,
      contributionAmount: 10000,
      method: 'wave',
      status: 'paid',
      paidAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
      ...extra,
    },
    roundNumber: 1,
    cycle: 1,
  };
}

describe('carnet électronique', () => {
  it('lit la taille d’un logo JPEG et refuse le reste', () => {
    expect(jpegFromDataUrl(TINY_JPEG)).toMatchObject({
      pixelWidth: 3,
      pixelHeight: 2,
      components: 3,
    });
    expect(jpegFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(jpegFromDataUrl(undefined)).toBeNull();
  });

  it('ne garde que les versements confirmés des périodes, et en fait le total', () => {
    const rounds = [round('r1', 1), round('r2', 2), round('w', 3, 'withdrawal')];
    const { lines, totals } = bookLines({ currentCycle: 1 }, rounds, [
      paid('p2', 'r2', 9, { latePenaltyAmount: 250 }),
      paid('p1', 'r1', 2, { membershipFeeAmount: 1000 }),
      paid('px', 'r2', 10, { status: 'failed' }),
    ]);
    expect(lines.map((line) => [line.paymentId, line.period])).toEqual([
      ['p1', 1],
      ['p2', 2],
    ]);
    expect(totals).toEqual({ saved: 20000, penalties: 250, fees: 1000 });
  });

  it('produit un PDF de plusieurs pages, avec le logo du groupe', () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      paymentId: `p${index}`,
      paidAt: '2026-11-02T10:00:00Z',
      period: index + 1,
      method: 'wave' as const,
      saved: 10000,
      penalty: 0,
      fee: 0,
    }));
    const bytes = buildBookPdf({
      groupName: 'Denthie Famille',
      photoUrl: TINY_JPEG,
      cycle: 1,
      holderName: 'Awa Fall',
      holderPhone: '772345678',
      facts: [['Rythme', 'Mensuelle']],
      lines,
      totals: { saved: 600000, penalties: 0, fees: 0 },
    });
    const pdf = String.fromCharCode(...bytes);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(Number(/\/Count (\d+)/.exec(pdf)?.[1])).toBeGreaterThan(1);
    expect(bookFileName('Denthie Famille', 'Awa Fall')).toBe('carnet-denthie-famille-awa-fall.pdf');
  });
});
