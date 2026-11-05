import type {
  CompleteProfileInput,
  LegalTerms,
  SessionState,
  TermsStatus,
  UpdateProfileInput,
  User,
} from '@/types';

/** Ce que la vérification du code SMS apprend sur le numéro. */
export interface OtpResult {
  /** Numéro sans compte : le profil (prénom, nom) est à remplir avant de créer le PIN. */
  isNewAccount: boolean;
  /** Prénom du compte, pour « Bonjour Awa ». */
  firstName?: string;
  /** Le compte a un PIN utilisable : il suffit de le saisir (sinon, il faut en créer un). */
  hasPin: boolean;
  /** Version des conditions à accepter sur l'écran du PIN ; null : déjà acceptées. */
  termsVersion: number | null;
}

/**
 * Connexion sans e-mail ni mot de passe :
 * 1. numéro de téléphone → un code est envoyé par SMS ;
 * 2. code SMS → le numéro est prouvé (mais la session n'est pas encore ouverte) ;
 * 3. PIN : créé (1re fois, PIN oublié ou bloqué) ou saisi → la session s'ouvre.
 * Aux ouvertures suivantes, l'application est verrouillée : seul le PIN est demandé.
 */
export interface AuthService {
  getSession(): Promise<SessionState>;
  /**
   * Connexion sur ordinateur : « pin » si le numéro a déjà un PIN utilisable (on le
   * demande directement), sinon « otp » (nouveau compte, PIN oublié, bloqué ou
   * réinitialisé : code SMS d'abord). Ne révèle ni le nom ni aucune autre donnée.
   */
  loginMethod(phone: string): Promise<'pin' | 'otp'>;
  /**
   * Envoie le code SMS. Inscription sur invitation : un numéro sans compte n'en reçoit un
   * qu'avec le code d'invitation d'un groupe pas encore démarré (sinon erreur « not_found »).
   */
  sendOtp(phone: string, inviteCode?: string): Promise<void>;
  /** Vérifie le code SMS : le numéro est alors prouvé pour l'étape suivante. */
  verifyOtp(phone: string, code: string): Promise<OtpResult>;
  /** Numéro sans compte : crée le compte (le PIN reste à créer). */
  completeProfile(input: CompleteProfileInput): Promise<void>;
  /**
   * Crée ou remplace le PIN du numéro prouvé par SMS, puis ouvre la session.
   * Conditions pas encore acceptées : `acceptedTermsVersion` (case cochée) est exigé.
   */
  setPin(pin: string, acceptedTermsVersion?: number): Promise<User>;
  /** Textes des conditions et de la politique de confidentialité (sans session). */
  legalTerms(): Promise<LegalTerms>;
  /** Personne connectée : a-t-elle accepté la version en vigueur ? */
  termsStatus(): Promise<TermsStatus>;
  /** Personne connectée : accepte la version en vigueur des conditions. */
  acceptTerms(version: number): Promise<void>;
  /** Connexion ou déverrouillage par PIN ; après trop d'erreurs, le PIN est bloqué. */
  loginWithPin(phone: string, pin: string): Promise<User>;
  /** Change le PIN de la personne connectée : le PIN actuel est exigé. */
  changePin(currentPin: string, newPin: string): Promise<void>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
  logout(): Promise<void>;
  /** Supprime (anonymise) le compte connecté, puis ferme la session. */
  deleteAccount(): Promise<void>;
}
