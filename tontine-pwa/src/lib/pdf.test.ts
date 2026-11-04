import { buildPdf, encodePdfText } from './pdf';

const toText = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('encodePdfText', () => {
  it('code les accents français en WinAnsi', () => {
    expect(encodePdfText('Reçu')).toBe('Reçu');
    expect(encodePdfText('l’Espoir').charCodeAt(1)).toBe(0x92);
  });

  it('remplace les espaces insécables et échappe les parenthèses', () => {
    expect(encodePdfText('45 000 (FCFA)')).toBe('45 000 \\(FCFA\\)');
  });
});

describe('buildPdf', () => {
  const bytes = buildPdf(420, 595, [
    { kind: 'rect', x: 0, y: 0, width: 420, height: 90, color: [30, 90, 168] },
    { kind: 'text', x: 32, y: 40, text: 'Reçu de cotisation', size: 14, color: [0, 0, 0] },
  ]);
  const text = toText(bytes);

  it('produit un document PDF complet', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(Reçu de cotisation) Tj');
  });

  it('pointe vers une table des références valide', () => {
    const offset = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(offset, offset + 4)).toBe('xref');
    const firstObject = Number(/0000000000 65535 f \n(\d{10})/.exec(text)?.[1]);
    expect(text.slice(firstObject, firstObject + 7)).toBe('1 0 obj');
  });
});
