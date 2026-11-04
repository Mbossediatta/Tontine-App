/**
 * Empreinte d'un PIN, salée par l'identifiant de l'utilisateur (deux personnes avec le
 * même PIN n'ont pas la même empreinte). Hachage FNV-1a : suffisant pour la simulation,
 * mais PAS pour la production, où le backend utilisera Argon2 ou bcrypt.
 */
export function hashPin(userId: string, pin: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${userId}:${pin}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
