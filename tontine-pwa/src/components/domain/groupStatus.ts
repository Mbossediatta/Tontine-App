import type { BadgeTone } from '@/components/ui';
import type { GroupStatus } from '@/types';

/** Libellé de chaque statut de groupe (une seule source pour toute l'application). */
export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  draft: 'Brouillon',
  active: 'En cours',
  finished: 'Terminé',
  suspended: 'Suspendu',
};

/** Couleur du badge : bleu pour un groupe en cours, rouge s'il est suspendu, neutre sinon. */
export const GROUP_STATUS_TONES: Record<GroupStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'info',
  finished: 'neutral',
  suspended: 'danger',
};
