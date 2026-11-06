// Base de données simulée : état en mémoire, conservé dans sessionStorage pendant la session
// (la redirection vers la page de paiement recharge l'application).
import { ServiceError } from '@/lib/errors';
import { createSeed, type MockDatabase } from '@/mocks';
import type { User } from '@/types';

// v12 : dettes (impayés au versement d'un tour).
const DB_KEY = 'tontine.mock.db.v12';
const SESSION_KEY = 'tontine.mock.session.v1';
const PENDING_PHONE_KEY = 'tontine.mock.pendingPhone.v1';

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée) : l'état reste en mémoire.
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

function load(): MockDatabase {
  const raw = safeGet(session, DB_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as MockDatabase;
    } catch {
      // Données corrompues : on repart des données de démonstration.
    }
  }
  return createSeed();
}

export const db: MockDatabase = load();

export function persist(): void {
  safeSet(session, DB_KEY, JSON.stringify(db));
}

export function resetDatabase(): void {
  Object.assign(db, createSeed());
  persist();
}

/** Délai réseau simulé de 300 à 600 ms. */
export function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 300));
}

export function requireOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ServiceError('Connexion requise pour cette action.', 'offline');
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// --- Session ---

export function getSessionUserId(): string | null {
  return safeGet(local, SESSION_KEY);
}

export function setSessionUserId(userId: string | null): void {
  safeSet(local, SESSION_KEY, userId);
}

export function getPendingPhone(): string | null {
  return safeGet(session, PENDING_PHONE_KEY);
}

export function setPendingPhone(phone: string | null): void {
  safeSet(session, PENDING_PHONE_KEY, phone);
}

export function findUser(userId: string): User | undefined {
  return db.users.find((user) => user.id === userId);
}

export function requireUser(userId: string): User {
  const user = findUser(userId);
  if (!user) throw new ServiceError('Utilisateur introuvable.', 'not_found');
  return user;
}

/** Utilisateur connecté ; erreur si personne n'est connecté ou si le compte est suspendu. */
export function currentUser(): User {
  const userId = getSessionUserId();
  const user = userId ? findUser(userId) : undefined;
  if (!user) throw new ServiceError('Veuillez vous reconnecter.', 'unauthenticated');
  if (user.isSuspended) throw new ServiceError('Votre compte est suspendu.', 'forbidden');
  return user;
}

export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return db.groups.some((group) => group.inviteCode === code) ? generateInviteCode() : code;
}
