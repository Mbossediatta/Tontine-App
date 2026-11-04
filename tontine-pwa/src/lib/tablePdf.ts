// Export PDF d'un tableau (rapports, transactions) : A4 paysage, plusieurs pages si besoin.
import { formatDateTime } from './format';
import { buildPagedPdf, downloadPdf, type PdfItem, type Rgb } from './pdf';

// Couleurs de la charte (DESIGN-UI.md) pour le document imprimé.
const BLUE_700: Rgb = [0x1e, 0x5a, 0xa8];
const BLUE_100: Rgb = [0xe3, 0xee, 0xfa];
const INK: Rgb = [0x1b, 0x27, 0x33];
const MUTED: Rgb = [0x5b, 0x6b, 0x7a];
const LINE: Rgb = [0xdc, 0xe5, 0xee];
const WHITE: Rgb = [0xff, 0xff, 0xff];

// A4 paysage, en points.
const WIDTH = 842;
const HEIGHT = 595;
const MARGIN = 32;
const ROW_HEIGHT = 20;
const TABLE_TOP = 120;
const FOOTER = 40;
/** Lignes de tableau par page. */
const ROWS_PER_PAGE = Math.floor((HEIGHT - TABLE_TOP - ROW_HEIGHT - FOOTER) / ROW_HEIGHT);

export interface PdfColumn {
  label: string;
  /** Part de la largeur du tableau (les parts sont additionnées puis réparties). */
  weight: number;
  /** Aligner à droite (montants, nombres). */
  right?: boolean;
}

export interface TablePdfOptions {
  title: string;
  subtitle: string;
  columns: PdfColumn[];
  rows: string[][];
  /** Ligne de total, en gras, sous la dernière ligne. */
  total?: string[];
  filename: string;
}

/** Coupe un texte trop long pour sa colonne (estimation : ~0,5 × taille de police par caractère). */
function fit(text: string, width: number, size: number): string {
  const max = Math.floor(width / (size * 0.52));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** Une ligne du tableau : chaque cellule dans sa colonne, aligné à gauche ou à droite. */
function rowItems(cells: string[], columns: PdfColumn[], y: number, bold: boolean): PdfItem[] {
  const tableWidth = WIDTH - MARGIN * 2;
  const totalWeight = columns.reduce((sum, c) => sum + c.weight, 0);
  const items: PdfItem[] = [];
  let x = MARGIN;
  columns.forEach((column, index) => {
    const width = (column.weight / totalWeight) * tableWidth;
    const text = fit(cells[index] ?? '', width - 8, 9);
    // Alignement à droite approximatif : largeur estimée du texte.
    const textX = column.right ? x + width - 4 - text.length * 9 * 0.5 : x + 4;
    items.push({ kind: 'text', x: textX, y, text, size: 9, bold, color: INK });
    x += width;
  });
  return items;
}

/** Génère et télécharge le PDF du tableau, découpé en pages. */
export function downloadTablePdf({
  title,
  subtitle,
  columns,
  rows,
  total,
  filename,
}: TablePdfOptions) {
  const chunks: string[][][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) {
    chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  const generatedAt = formatDateTime(new Date());

  const pages = chunks.map((chunk, pageIndex) => {
    const items: PdfItem[] = [
      // Bandeau bleu avec le nom de l'application et le titre du document.
      { kind: 'rect', x: 0, y: 0, width: WIDTH, height: 70, color: BLUE_700 },
      {
        kind: 'text',
        x: MARGIN,
        y: 32,
        text: 'Calebasse de l’Espoir',
        size: 16,
        bold: true,
        color: WHITE,
      },
      { kind: 'text', x: MARGIN, y: 54, text: title, size: 12, color: WHITE },
      { kind: 'text', x: MARGIN, y: 96, text: subtitle, size: 10, color: MUTED },
      // En-tête de colonnes sur fond bleu clair.
      {
        kind: 'rect',
        x: MARGIN,
        y: TABLE_TOP - 14,
        width: WIDTH - MARGIN * 2,
        height: ROW_HEIGHT,
        color: BLUE_100,
      },
      ...rowItems(
        columns.map((c) => c.label),
        columns,
        TABLE_TOP,
        true,
      ),
    ];
    chunk.forEach((cells, index) => {
      const y = TABLE_TOP + ROW_HEIGHT * (index + 1);
      items.push(...rowItems(cells, columns, y, false), {
        kind: 'line',
        x1: MARGIN,
        y1: y + 6,
        x2: WIDTH - MARGIN,
        y2: y + 6,
        width: 0.5,
        color: LINE,
      });
    });
    // Total en bas de la dernière page.
    if (total && pageIndex === chunks.length - 1) {
      items.push(
        ...rowItems(total, columns, TABLE_TOP + ROW_HEIGHT * (chunk.length + 1) + 4, true),
      );
    }
    items.push({
      kind: 'text',
      x: MARGIN,
      y: HEIGHT - 20,
      text: `Généré le ${generatedAt} · page ${pageIndex + 1} sur ${chunks.length}`,
      size: 8,
      color: MUTED,
    });
    return items;
  });

  downloadPdf(buildPagedPdf(WIDTH, HEIGHT, pages), filename);
}
