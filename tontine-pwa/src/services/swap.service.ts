import type { SwapView } from '@/types';

export interface SwapService {
  /** Échanges du cycle en cours : tous pour les administrateurs, les miens pour un membre. */
  list(groupId: string): Promise<SwapView[]>;
  /** Je demande à prendre le tour `partnerRoundId` en échange du mien. */
  request(groupId: string, partnerRoundId: string): Promise<void>;
  /** Réponse du membre sollicité. */
  respond(swapId: string, accept: boolean): Promise<void>;
  /** Validation finale par un administrateur du groupe. */
  decide(swapId: string, approve: boolean): Promise<void>;
  cancel(swapId: string): Promise<void>;
}
