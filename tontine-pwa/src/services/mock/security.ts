// Journal de sécurité simulé : tentatives de connexion, accès refusés, saisies suspectes.
// En production, c'est le serveur qui enregistre ces événements : lui seul voit toutes
// les requêtes, y compris celles qui ne passent pas par l'application.
import { ServiceError } from '@/lib/errors';
import type { SecurityEventKind, SecuritySeverity } from '@/types';
import { db, newId, nowIso, persist } from './db';

const SEVERITY: Record<SecurityEventKind, SecuritySeverity> = {
  admin_login: 'info',
  pin_failed: 'warning',
  otp_failed: 'warning',
  access_denied: 'warning',
  pin_blocked: 'critical',
  suspicious_input: 'critical',
};

/** Journal limité aux derniers événements, pour ne pas grossir sans fin. */
const MAX_EVENTS = 2000;

export function recordSecurityEvent(
  kind: SecurityEventKind,
  detail: string,
  who: { userId?: string; phone?: string } = {},
): void {
  db.securityEvents.push({
    id: newId('sec'),
    kind,
    severity: SEVERITY[kind],
    detail,
    ...who,
    at: nowIso(),
  });
  if (db.securityEvents.length > MAX_EVENTS) {
    db.securityEvents.splice(0, db.securityEvents.length - MAX_EVENTS);
  }
  // Enregistré tout de suite : l'action qui suit échoue souvent (erreur levée).
  persist();
}

/**
 * Signatures d'attaques courantes : injection SQL et injection de script (XSS).
 * Elles ne visent que des formes sans ambiguïté, pour ne pas refuser un nom
 * ordinaire avec une apostrophe (« N'Diaye ») ou un tiret.
 */
const ATTACKS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /<\s*script|<\s*iframe|javascript\s*:|\bon(error|load|click)\s*=/i,
    label: 'injection de script',
  },
  {
    pattern:
      /\bunion\s+(all\s+)?select\b|\bdrop\s+table\b|\bdelete\s+from\b|\binsert\s+into\b|'\s*or\s+'?\d+'?\s*=\s*'?\d+|;\s*--|\/\*.*\*\//i,
    label: 'injection SQL',
  },
];

/**
 * Vérifie un texte saisi. S'il ressemble à une attaque, l'événement est enregistré et
 * la saisie refusée. Le serveur protège de toute façon la base (requêtes paramétrées,
 * règles d'accès) : ce contrôle sert surtout à repérer et signaler les tentatives.
 */
export function inspectInput(field: string, value: string | undefined, userId?: string): void {
  if (!value) return;
  const attack = ATTACKS.find(({ pattern }) => pattern.test(value));
  if (!attack) return;
  recordSecurityEvent(
    'suspicious_input',
    `Saisie refusée dans « ${field} » : ressemble à une ${attack.label}`,
    { userId },
  );
  throw new ServiceError('Ce texte contient des caractères non autorisés.', 'invalid');
}
