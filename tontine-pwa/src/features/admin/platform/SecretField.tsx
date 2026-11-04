import { Input } from '@/components/ui';

/**
 * Clé secrète en écriture seule : la clé enregistrée n'est jamais affichée (ni même
 * envoyée à la page), seulement son indice. On peut en saisir une nouvelle ; vide,
 * l'actuelle est gardée.
 */
export function SecretField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  /** Indice de la clé enregistrée (« •••• 3f9a »), ou null s'il n'y en a pas. */
  hint: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      label={label}
      type="password"
      autoComplete="new-password"
      value={value}
      placeholder={hint ? 'Laisser vide pour garder la clé actuelle' : 'Saisir la clé'}
      hint={hint ? `Clé enregistrée : ${hint}` : 'Aucune clé enregistrée.'}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
