// Export tableur : fichier CSV que Excel (version française) ouvre directement.

export type CsvCell = string | number;

/**
 * Met une cellule au format CSV : si elle contient le séparateur, un guillemet
 * ou un retour à la ligne, elle est entourée de guillemets (guillemets internes doublés).
 */
function escapeCell(value: CsvCell): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Construit le texte CSV. Le séparateur est le point-virgule : c'est celui
 * qu'attend Excel en français (la virgule y sert de séparateur décimal).
 */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(';')).join('\r\n');
}

/**
 * Propose le fichier au téléchargement.
 * Le BOM UTF-8 en tête indique l'encodage à Excel, sans quoi les accents s'affichent mal.
 */
export function downloadCsv(rows: CsvCell[][], filename: string): void {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
