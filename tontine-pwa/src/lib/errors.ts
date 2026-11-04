export type ServiceErrorCode =
  'offline' | 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict';

/** Erreur métier dont le message est directement affichable à l'utilisateur. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(message: string, code: ServiceErrorCode = 'invalid') {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  return 'Une erreur est survenue. Vérifiez votre connexion et réessayez.';
}
