import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

interface CodeBoxesProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Code refusé : cases rouges. */
  invalid?: boolean;
  /** Change à chaque erreur : les cases tremblent de nouveau. */
  shakeKey?: number;
  disabled?: boolean;
  label: string;
}

/**
 * Saisie du code SMS, une case par chiffre :
 * - le curseur passe tout seul à la case suivante (et revient avec Retour arrière) ;
 * - coller le code entier, ou le remplissage automatique depuis le SMS
 *   (autocomplete="one-time-code"), remplit toutes les cases d'un coup.
 */
export function CodeBoxes({
  value,
  onChange,
  length = 6,
  invalid = false,
  shakeKey = 0,
  disabled = false,
  label,
}: CodeBoxesProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value.charAt(i));

  const focus = (index: number) => refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  };

  const handleInput = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    // Plusieurs chiffres d'un coup : remplissage automatique du SMS ou collage.
    if (clean.length > 1) {
      onChange(clean.slice(0, length));
      focus(clean.length);
      return;
    }
    setDigit(index, clean);
    if (clean) focus(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) {
      event.preventDefault();
      setDigit(index - 1, '');
      focus(index - 1);
    } else if (event.key === 'ArrowLeft') {
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      focus(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    focus(pasted.length);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      {/* La clé change à chaque erreur : l'animation « shake » rejoue. */}
      <div
        key={shakeKey}
        className={cn('flex justify-between gap-2', shakeKey > 0 && 'motion-safe:animate-shake')}
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={length}
            value={digit}
            disabled={disabled}
            autoFocus={index === 0}
            aria-label={`Chiffre ${index + 1} sur ${length}`}
            aria-invalid={invalid || undefined}
            onChange={(event) => handleInput(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.target.select()}
            className={cn(
              // Case active : bordure et contour bleus, nettement visibles même sur une case remplie.
              'h-14 w-full min-w-0 max-w-[52px] rounded-[12px] border-2 bg-white text-center text-[22px] font-bold text-auth-ink transition-colors focus:border-auth-primary focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-auth-primary disabled:opacity-60',
              invalid ? 'border-auth-error' : digit ? 'border-auth-ink' : 'border-auth-line',
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}
