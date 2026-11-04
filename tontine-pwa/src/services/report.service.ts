import type { AuditView, PlatformReport, SecurityEventView } from '@/types';

/** Rapports, journal d'audit et journal de sécurité (super administrateur). */
export interface ReportService {
  /** Bilan de la plateforme entre deux dates (ISO), par groupe et par administrateur. */
  report(from: string, to: string): Promise<PlatformReport>;
  /** Tout le journal d'audit, de l'action la plus récente à la plus ancienne. */
  auditLog(): Promise<AuditView[]>;
  /**
   * Événements de sécurité (PIN et codes SMS refusés, accès refusés, saisies suspectes,
   * connexions des admins), du plus récent au plus ancien.
   */
  securityLog(): Promise<SecurityEventView[]>;
}
