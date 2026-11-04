import type { AnnouncementTarget, SmsStats } from '@/types';

/** Annonces et suivi des SMS (super administrateur). */
export interface CommunicationService {
  /** Envoie une annonce (notification + SMS) ; renvoie le nombre de destinataires. */
  announce(target: AnnouncementTarget, title: string, message: string): Promise<number>;
  /** SMS envoyés sur les `days` derniers jours : volume, coût, détail par motif. */
  smsStats(days: number): Promise<SmsStats>;
}
