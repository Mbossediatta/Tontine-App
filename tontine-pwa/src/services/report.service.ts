import type { AuditView, PlatformReport } from '@/types';

/** Rapports et journal d'audit (super administrateur). */
export interface ReportService {
  /** Bilan de la plateforme entre deux dates (ISO), par groupe et par administrateur. */
  report(from: string, to: string): Promise<PlatformReport>;
  /** Tout le journal d'audit, de l'action la plus récente à la plus ancienne. */
  auditLog(): Promise<AuditView[]>;
}
