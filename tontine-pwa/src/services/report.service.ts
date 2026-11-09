import type {
  AuditActor,
  AuditFilters,
  AuditSummary,
  AuditView,
  ListPage,
  PageCursor,
  PlatformReport,
  SecurityEventView,
  SecurityFilters,
  SecuritySummary,
  SecurityTotals,
} from '@/types';

/** Rapports, journal d'audit et journal de sécurité (super administrateur). */
export interface ReportService {
  /** Bilan de la plateforme entre deux dates (ISO), par groupe et par administrateur. */
  report(from: string, to: string): Promise<PlatformReport>;
  /** Tout le journal d'audit, de l'action la plus récente à la plus ancienne. */
  auditLog(): Promise<AuditView[]>;
  /**
   * Une page du journal d'audit (du plus récent au plus ancien), filtrée par le serveur.
   * Sans `cursor` : la première page, avec ses totaux.
   */
  auditPage(
    filters: AuditFilters,
    cursor?: PageCursor,
    limit?: number,
  ): Promise<ListPage<AuditView, AuditSummary>>;
  /** Auteurs présents dans le journal, par ordre alphabétique (filtre « Auteur »). */
  auditActors(): Promise<AuditActor[]>;
  /**
   * Événements de sécurité (PIN et codes SMS refusés, accès refusés, saisies suspectes,
   * connexions des admins), du plus récent au plus ancien.
   */
  securityLog(): Promise<SecurityEventView[]>;
  /** Une page du journal de sécurité, filtrée par le serveur. */
  securityPage(
    filters: SecurityFilters,
    cursor?: PageCursor,
    limit?: number,
  ): Promise<ListPage<SecurityEventView, SecurityTotals>>;
  /** Compteurs de la rubrique Sécurité (7 derniers jours, alertes critiques, filtres). */
  securitySummary(): Promise<SecuritySummary>;
}
