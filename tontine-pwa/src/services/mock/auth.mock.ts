import { ServiceError } from '@/lib/errors';
import type { User } from '@/types';
import type { AuthService } from '../auth.service';
import { recordAudit } from './audit';
import {
  currentUser,
  db,
  delay,
  findUser,
  getPendingPhone,
  getSessionUserId,
  newId,
  persist,
  requireOnline,
  setPendingPhone,
  setSessionUserId,
} from './db';
import { checkOtp, issueOtp } from './otp';
import { checkPin, needsPin, savePin } from './pin';

/** Compte associé à un numéro, refusé s'il est bloqué. */
function activeUserByPhone(phone: string): User | undefined {
  const user = db.users.find((item) => item.phone === phone && !item.deletedAt);
  if (user?.isSuspended) {
    throw new ServiceError('Ce compte est bloqué. Contactez un administrateur.', 'forbidden');
  }
  return user;
}

/** Ouvre la session ; les connexions des administrateurs sont tracées dans le journal d'audit. */
function openSession(user: User): void {
  setPendingPhone(null);
  setSessionUserId(user.id);
  if (user.globalRole !== 'user') recordAudit(user, 'login', 's’est connecté');
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/**
 * Supprime le compte : refusé s'il reste des engagements (tontine en cours, groupe possédé).
 * Les données personnelles sont effacées ; l'historique des paiements est conservé de façon
 * anonyme pour la comptabilité des autres membres.
 */
function deleteCurrentAccount(): void {
  const user = currentUser();
  if (user.globalRole === 'super_admin') {
    throw new ServiceError(
      'Le compte du super administrateur ne peut pas être supprimé.',
      'forbidden',
    );
  }
  const memberships = db.memberships.filter((m) => m.userId === user.id && m.status !== 'removed');
  const groupOf = (groupId: string) => db.groups.find((g) => g.id === groupId);
  const ongoing = memberships.find(
    (m) => m.status === 'active' && groupOf(m.groupId)?.status === 'active',
  );
  if (ongoing) {
    throw new ServiceError(
      `Vous participez à une tontine en cours (« ${groupOf(ongoing.groupId)?.name ?? ''} »). Vous pourrez supprimer votre compte à la fin du cycle.`,
      'conflict',
    );
  }
  const owned = memberships.find(
    (m) => m.role === 'owner' && groupOf(m.groupId)?.status === 'draft',
  );
  if (owned) {
    throw new ServiceError(
      `Vous êtes propriétaire du groupe « ${groupOf(owned.groupId)?.name ?? ''} ». Supprimez-le d’abord.`,
      'conflict',
    );
  }
  for (const membership of memberships) {
    if (groupOf(membership.groupId)?.status !== 'finished') {
      membership.status = 'removed';
      membership.payoutOrder = undefined;
    }
  }
  for (const swap of db.swapRequests) {
    const involved = swap.requesterId === user.id || swap.partnerId === user.id;
    if (involved && (swap.status === 'pending_partner' || swap.status === 'pending_admin')) {
      swap.status = 'cancelled';
    }
  }
  Object.assign(user, {
    firstName: 'Compte',
    lastName: 'supprimé',
    phone: '',
    avatarUrl: undefined,
    payoutPhone: undefined,
    payoutMethod: undefined,
    globalRole: 'user',
    isSuspended: true,
    deletedAt: new Date().toISOString(),
  });
  db.notifications = db.notifications.filter((n) => n.userId !== user.id);
  db.preferences = withoutKey(db.preferences, user.id);
  db.pushSubscriptions = withoutKey(db.pushSubscriptions, user.id);
  persist();
  setSessionUserId(null);
  setPendingPhone(null);
}

export const mockAuthService: AuthService = {
  async getSession() {
    const userId = getSessionUserId();
    const user = userId ? findUser(userId) : undefined;
    const lockAfterMinutes = db.settings.security.inactivityLockMinutes;
    if (user && !user.isSuspended) {
      return { user, needsProfile: false, needsPin: needsPin(user.id), lockAfterMinutes };
    }
    if (userId) setSessionUserId(null);
    // Numéro prouvé par SMS mais sans compte : le profil est à remplir.
    const verified = getPendingPhone();
    const needsProfile = verified !== null && !db.users.some((u) => u.phone === verified);
    return { user: null, needsProfile, needsPin: false, lockAfterMinutes };
  },

  async sendOtp(phone) {
    requireOnline();
    await delay();
    activeUserByPhone(phone); // un compte bloqué ne reçoit pas de code
    await issueOtp(phone);
    persist();
  },

  async verifyOtp(phone, code) {
    requireOnline();
    await delay();
    checkOtp(phone, code);
    const user = activeUserByPhone(phone);
    // Le numéro est prouvé : il ouvre droit à l'étape suivante (profil ou PIN).
    setPendingPhone(phone);
    return {
      isNewAccount: !user,
      firstName: user?.firstName,
      hasPin: user ? !needsPin(user.id) : false,
    };
  },

  async completeProfile(input) {
    requireOnline();
    await delay();
    const phone = getPendingPhone();
    if (!phone)
      throw new ServiceError('Session expirée, recommencez la connexion.', 'unauthenticated');
    if (db.users.some((u) => u.phone === phone && !u.deletedAt)) {
      throw new ServiceError('Un compte existe déjà avec ce numéro.', 'conflict');
    }
    db.users.push({
      id: newId('u'),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone,
      avatarUrl: input.avatarUrl,
      globalRole: 'user',
      isSuspended: false,
      createdAt: new Date().toISOString(),
    });
    persist();
  },

  async setPin(pin) {
    requireOnline();
    await delay();
    // Créer ou remplacer un PIN exige un numéro prouvé par SMS… sauf pour un compte
    // connecté qui n'a jamais eu de PIN (il ne remplace rien).
    const verified = getPendingPhone();
    const sessionId = getSessionUserId();
    const sessionUser = sessionId ? findUser(sessionId) : undefined;
    const user = verified
      ? activeUserByPhone(verified)
      : sessionUser && needsPin(sessionUser.id)
        ? sessionUser
        : undefined;
    if (!user)
      throw new ServiceError('Session expirée, recommencez la connexion.', 'unauthenticated');
    savePin(user.id, pin);
    openSession(user);
    persist();
    return user;
  },

  async loginWithPin(phone, pin) {
    requireOnline();
    await delay();
    const user = activeUserByPhone(phone);
    if (!user) throw new ServiceError('Aucun compte avec ce numéro.', 'not_found');
    try {
      checkPin(user.id, pin);
    } finally {
      // Le compteur d'essais ratés doit être enregistré même en cas d'erreur.
      persist();
    }
    openSession(user);
    persist();
    return user;
  },

  async changePin(currentPin, newPin) {
    requireOnline();
    await delay();
    const user = currentUser();
    try {
      // Mêmes règles qu'à la connexion : essais comptés, blocage au-delà de la limite.
      checkPin(user.id, currentPin);
    } finally {
      persist();
    }
    if (currentPin === newPin) throw new ServiceError('Choisissez un code différent de l’actuel.');
    savePin(user.id, newPin);
    persist();
  },

  async updateProfile(input) {
    requireOnline();
    await delay();
    const user = currentUser();
    Object.assign(user, input);
    persist();
    return { ...user };
  },

  async deleteAccount() {
    requireOnline();
    await delay();
    deleteCurrentAccount();
  },

  async logout() {
    setSessionUserId(null);
    setPendingPhone(null);
  },
};

/** Connexion directe à un compte de démonstration (mode simulé uniquement). */
export async function demoLogin(userId: string): Promise<void> {
  await delay();
  if (!findUser(userId)) throw new ServiceError('Compte de démonstration introuvable.');
  setPendingPhone(null);
  setSessionUserId(userId);
}
