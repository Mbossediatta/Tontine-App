import { subDays, subHours, subMinutes } from 'date-fns';
import type { SecurityEvent } from '@/types';

/** Quelques événements passés, pour que la rubrique « Sécurité » de démonstration ne soit pas vide. */
export function seedSecurityEvents(now: Date = new Date()): SecurityEvent[] {
  const at = (date: Date) => date.toISOString();
  return [
    {
      id: 'sec-1',
      kind: 'admin_login',
      severity: 'info',
      detail: 'Connexion d’un administrateur',
      userId: 'u-admin1',
      at: at(subDays(now, 2)),
    },
    {
      id: 'sec-2',
      kind: 'otp_failed',
      severity: 'warning',
      detail: 'Code SMS incorrect',
      phone: '761112233',
      at: at(subDays(now, 1)),
    },
    {
      id: 'sec-3',
      kind: 'suspicious_input',
      severity: 'critical',
      detail: 'Saisie refusée dans « Nom du groupe » : ressemble à une injection SQL',
      userId: 'u-p3',
      at: at(subHours(now, 20)),
    },
    {
      id: 'sec-4',
      kind: 'pin_failed',
      severity: 'warning',
      detail: 'PIN incorrect · il reste 4 essais',
      userId: 'u-p2',
      at: at(subHours(now, 5)),
    },
    {
      id: 'sec-5',
      kind: 'access_denied',
      severity: 'warning',
      detail: 'Accès refusé à un groupe dont le compte n’est pas membre',
      userId: 'u-p4',
      at: at(subMinutes(now, 90)),
    },
  ];
}
