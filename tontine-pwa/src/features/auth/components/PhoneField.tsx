import { useId } from 'react';
import { cn } from '@/lib/cn';
import { formatPhoneLocal, normalizePhone } from '@/lib/format';
import { isSenegalMobile } from '@/lib/checks';

interface PhoneFieldProps {
  /** Les 9 chiffres saisis (sans espaces ni indicatif). */
  value: string;
  onChange: (digits: string) => void;
  error?: string;
  autoFocus?: boolean;
  /** Texte d'aide sous le champ (par défaut : le code arrive par SMS). */
  hint?: string;
}

/**
 * Champ du numéro : indicatif +221 affiché devant, clavier numérique, et espaces
 * ajoutés au fil de la frappe (« 77 123 45 67 »). Seuls les chiffres sont conservés.
 */
export function PhoneField({
  value,
  onChange,
  error,
  autoFocus,
  hint = 'Vous recevrez un code de vérification par SMS.',
}: PhoneFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  // Neuf chiffres saisis mais pas un mobile sénégalais : on le dit tout de suite.
  const wrongPrefix = value.length === 9 && !isSenegalMobile(value);
  const message =
    error ?? (wrongPrefix ? 'Un numéro mobile commence par 7 (ex. 77 123 45 67).' : undefined);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] font-semibold text-auth-ink">
        Numéro de téléphone
      </label>
      <div
        className={cn(
          'flex h-14 overflow-hidden rounded-[12px] border-2 bg-white focus-within:border-auth-primary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-auth-primary',
          message ? 'border-auth-error' : 'border-auth-line',
        )}
      >
        <span className="flex items-center border-r border-auth-line bg-auth-page px-4 text-[17px] font-semibold text-auth-ink">
          +221
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          placeholder="77 123 45 67"
          value={formatPhoneLocal(value)}
          // normalizePhone retire un « +221 » collé avec le numéro.
          onChange={(event) => onChange(normalizePhone(event.target.value).slice(0, 9))}
          aria-invalid={message ? true : undefined}
          aria-describedby={hintId}
          // Le contour du bloc entier montre le focus : pas de second contour ici.
          className="min-w-0 flex-1 bg-transparent px-4 text-[17px] font-medium tracking-wide text-auth-ink placeholder:font-normal placeholder:text-auth-muted focus:outline-none"
        />
      </div>
      <p
        id={hintId}
        role={message ? 'alert' : undefined}
        className={cn(
          'text-[13px] leading-5',
          message ? 'font-medium text-auth-error' : 'text-auth-muted',
        )}
      >
        {message ?? hint}
      </p>
    </div>
  );
}
