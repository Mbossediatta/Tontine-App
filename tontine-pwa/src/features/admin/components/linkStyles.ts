/** Classes d'un lien présenté comme un bouton dans l'en-tête des tableaux de bord. */
export const headerLinkClass = {
  /** Action principale : bleu plein. */
  blue: 'inline-flex min-h-touch items-center gap-1.5 rounded-control bg-blue-700 px-4 text-label font-bold text-white transition-colors duration-150 hover:bg-blue-900',
  /** Action secondaire : contour gris. */
  outline:
    'inline-flex min-h-touch items-center gap-1.5 rounded-control border border-line bg-white px-4 text-label font-bold text-ink transition-colors duration-150 hover:border-blue-700 hover:text-blue-700',
} as const;

/**
 * Bouton d'action dans une ligne de tableau (Relancer, Espèces reçues, Suspendre…).
 * Sur téléphone : les boutons se partagent la largeur et montent à 48 px de haut,
 * pour être faciles à toucher. Sur écran large : taille naturelle.
 */
export const rowActionClass = 'flex-1 max-md:min-h-button md:flex-none';
