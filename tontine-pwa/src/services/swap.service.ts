import type { SwapView } from '@/types';

export interface SwapService {
  /** Échanges du cycle en cours : tous pour les administrateurs, les miens pour un membre. */
  list(groupId: string): Promise<SwapView[]>;
  /**
   * Je propose mon tour `myRoundId` contre le tour `partnerRoundId`. Sans `partnerId` (tour
   * anonyme pour un membre), le serveur retrouve le membre de ce tour.
   */
  request(myRoundId: string, partnerRoundId: string, partnerId?: string): Promise<void>;
  /** Réponse du membre sollicité. */
  respond(swapId: string, accept: boolean): Promise<void>;
  /** Validation finale par un administrateur du groupe. */
  decide(swapId: string, approve: boolean): Promise<void>;
  cancel(swapId: string): Promise<void>;
}
