import type { AnnouncementTarget, NotificationStats, SmsStats } from '@/types';

/** Canal d'une annonce : l'application seule, ou l'application plus un SMS. */
export type AnnouncementChannel = 'app' | 'sms';

/** Annonces et suivi des SMS (super administrateur). */
export interface CommunicationService {
  /**
   * Envoie une annonce : notification dans l'application (et push), plus un SMS si
   * `channel` vaut « sms ». Renvoie le nombre de destinataires.
   */
  announce(
    target: AnnouncementTarget,
    title: string,
    message: string,
    channel?: AnnouncementChannel,
  ): Promise<number>;
  /** SMS envoyés sur les `days` derniers jours : volume, coût, détail par motif. */
  smsStats(days: number): Promise<SmsStats>;
  /** Notifications envoyées dans l'application sur les `days` derniers jours, par type. */
  notificationStats(days: number): Promise<NotificationStats>;
}
