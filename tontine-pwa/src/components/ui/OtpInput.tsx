import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: string;
  disabled?: boolean;
  label?: string;
  /** Chiffres masqués (PIN) : points à la place des chiffres, pas de remplissage SMS. */
  masked?: boolean;
}

/** Saisie d'un code à N chiffres (code SMS ou PIN), une case par chiffre, avec collage automatique. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  error,
  disabled,
  label = 'Code reçu par SMS',
  masked = false,
}: OtpInputProps) {
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
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-label text-muted">{label}</legend>
      {/* Code SMS (6 cases) : pleine largeur. PIN (4 cases) : cases groupées au centre. */}
      <div className={cn('flex', length > 4 ? 'justify-between gap-2' : 'justify-center gap-3')}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type={masked ? 'password' : 'text'}
            inputMode="numeric"
            autoComplete={masked ? 'off' : index === 0 ? 'one-time-code' : 'off'}
            maxLength={length}
            value={digit}
            disabled={disabled}
            autoFocus={index === 0}
            aria-label={`Chiffre ${index + 1} sur ${length}`}
            aria-invalid={error ? true : undefined}
            onChange={(event) => handleInput(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.target.select()}
            className={cn(
              'h-14 w-12 min-w-0 rounded-control border-2 text-center font-display text-page-title tabular-nums text-blue-900 focus:border-blue-700 focus:outline-none',
              error
                ? 'border-danger bg-white'
                : digit
                  ? 'border-green-300 bg-green-50'
                  : 'border-line bg-white',
            )}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
