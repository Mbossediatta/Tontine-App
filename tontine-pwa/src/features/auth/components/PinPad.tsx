import { useEffect } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/cn';

export const PIN_LENGTH = 4;

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Pavé inactif (envoi en cours, PIN bloqué). */
  disabled?: boolean;
  /** Change à chaque erreur : les points tremblent. */
  shakeKey?: number;
  invalid?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Forme commune des touches : 64 px de haut, coins arrondis, contour bleu au focus. */
const keyBase =
  'flex h-16 items-center justify-center rounded-[16px] text-[26px] font-semibold text-auth-ink transition-colors duration-100 hover:bg-[#E8EEF5] active:bg-[#DCE5EF] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2';
/** Touche chiffre : fond gris clair, pour bien voir la zone à toucher. */
const keyClass = `${keyBase} bg-auth-page disabled:hover:bg-auth-page`;
/** Touche « effacer » : simple icône, sans fond, comme sur un téléphone. */
const eraseClass = `${keyBase} bg-transparent disabled:hover:bg-transparent`;

/**
 * Code PIN : 4 points (pleins au fil de la saisie) et pavé numérique intégré à l'écran,
 * à gros boutons de 64 px. Le PIN n'apparaît jamais en clair. Sur ordinateur, les
 * chiffres et la touche Retour arrière du clavier fonctionnent aussi.
 */
export function PinPad({
  value,
  onChange,
  disabled = false,
  shakeKey = 0,
  invalid = false,
}: PinPadProps) {
  const press = (digit: string) => {
    if (!disabled && value.length < PIN_LENGTH) onChange(value + digit);
  };
  const erase = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  // Clavier physique : chiffres et Retour arrière.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key) && value.length < PIN_LENGTH) {
        event.preventDefault();
        onChange(value + event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        onChange(value.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, value, onChange]);

  return (
    // w-full : le pavé prend toute la largeur disponible (jusqu'à 300 px), même dans un parent centré.
    <div className="flex w-full flex-col items-center gap-8">
      {/* Points du PIN ; la clé change à chaque erreur pour rejouer le tremblement. */}
      <div
        key={shakeKey}
        role="img"
        aria-label={`Code PIN : ${value.length} chiffre${value.length > 1 ? 's' : ''} saisi${value.length > 1 ? 's' : ''} sur ${PIN_LENGTH}`}
        className={cn('flex gap-5', shakeKey > 0 && 'motion-safe:animate-shake')}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-4 w-4 rounded-full border-2 transition-colors duration-100',
              invalid
                ? 'border-auth-error bg-auth-error'
                : index < value.length
                  ? 'border-auth-ink bg-auth-ink'
                  : 'border-auth-line bg-white',
            )}
          />
        ))}
      </div>

      <div className="grid w-full max-w-[300px] grid-cols-3 gap-3">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={keyClass}
            disabled={disabled}
            onClick={() => press(digit)}
            aria-label={`Chiffre ${digit}`}
          >
            {digit}
          </button>
        ))}
        {/* Case vide à gauche du 0, pour garder le 0 au centre comme sur un téléphone. */}
        <span aria-hidden="true" />
        <button
          type="button"
          className={keyClass}
          disabled={disabled}
          onClick={() => press('0')}
          aria-label="Chiffre 0"
        >
          0
        </button>
        <button
          type="button"
          className={eraseClass}
          disabled={disabled || value.length === 0}
          onClick={erase}
          aria-label="Effacer le dernier chiffre"
        >
          <Delete className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
