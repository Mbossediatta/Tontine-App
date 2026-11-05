// Vérifications simples, sans dépendance : utilisables partout (écrans de connexion,
// services) sans charger la bibliothèque de formulaires Zod (lib/validators), lourde.

/**
 * PIN trop facile à deviner : 4 chiffres identiques (0000, 7777) ou une suite
 * (1234, 4321, 6789…).
 */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - (digits[i] ?? 0));
  return (
    steps.every((step) => step === 0) ||
    steps.every((step) => step === 1) ||
    steps.every((step) => step === -1)
  );
}

/** Numéro mobile sénégalais : 9 chiffres commençant par 7 (70, 75, 76, 77, 78). */
export function isSenegalMobile(digits: string): boolean {
  return /^7\d{8}$/.test(digits);
}
