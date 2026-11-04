// Générateur PDF minimal (une page, polices Helvetica standard), sans dépendance.
// Les coordonnées sont en points (1/72 de pouce), mesurées depuis le coin supérieur gauche.

export type Rgb = readonly [number, number, number];

export type PdfItem =
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; color: Rgb }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: Rgb }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: Rgb };

// Caractères du codage WinAnsi situés hors de Latin-1.
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

/** Convertit un texte en chaîne PDF (codage WinAnsi, caractères spéciaux échappés). */
export function encodePdfText(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0x3f;
    let byte: number;
    if (char === ' ' || char === ' ') byte = 0x20;
    else if (WIN_ANSI_EXTRA[char] !== undefined) byte = WIN_ANSI_EXTRA[char];
    else if (code < 0x100 && (code < 0x80 || code >= 0xa0)) byte = code;
    else byte = 0x3f; // « ? » pour les caractères non représentables
    const encoded = String.fromCharCode(byte);
    out += encoded === '(' || encoded === ')' || encoded === '\\' ? `\\${encoded}` : encoded;
  }
  return out;
}

const rgb = ([r, g, b]: Rgb) => [r, g, b].map((v) => (v / 255).toFixed(3)).join(' ');
const num = (value: number) => Number(value.toFixed(2)).toString();

function contentStream(items: PdfItem[], pageHeight: number): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case 'rect':
          return `${rgb(item.color)} rg ${num(item.x)} ${num(pageHeight - item.y - item.height)} ${num(item.width)} ${num(item.height)} re f`;
        case 'line':
          return `${rgb(item.color)} RG ${num(item.width)} w ${num(item.x1)} ${num(pageHeight - item.y1)} m ${num(item.x2)} ${num(pageHeight - item.y2)} l S`;
        case 'text':
          return `BT /${item.bold ? 'F2' : 'F1'} ${num(item.size)} Tf ${rgb(item.color)} rg ${num(item.x)} ${num(pageHeight - item.y)} Td (${encodePdfText(item.text)}) Tj ET`;
      }
    })
    .join('\n');
}

/** Construit un document PDF d'une page et renvoie ses octets. */
export function buildPdf(width: number, height: number, items: PdfItem[]): Uint8Array {
  return buildPagedPdf(width, height, [items]);
}

/**
 * Construit un document PDF de plusieurs pages (même format pour toutes).
 * Objets : 1 catalogue, 2 liste des pages, 3-4 polices, puis pour chaque page
 * son objet « page » suivi de son contenu.
 */
export function buildPagedPdf(width: number, height: number, pages: PdfItem[][]): Uint8Array {
  const FIRST_PAGE = 5;
  const pageIds = pages.map((_, index) => FIRST_PAGE + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((items, index) => {
    const stream = contentStream(items, height);
    const contentId = (pageIds[index] ?? 0) + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  // Chaque caractère occupe un octet : la longueur de la chaîne donne les positions.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** Propose le fichier au téléchargement. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
