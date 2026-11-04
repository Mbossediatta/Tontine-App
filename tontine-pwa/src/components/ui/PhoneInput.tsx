import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';
import { formatPhoneLocal } from '@/lib/format';
import { Field } from './Field';
import { describedBy } from './fieldUtils';

interface PhoneInputProps {
  label: string;
  /** Les 9 chiffres du numéro, sans indicatif. */
  value: string;
  onChange: (digits: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
}

/** Champ téléphone sénégalais : indicatif +221 fixe et masque « 77 123 45 67 ». */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { label, value, onChange, onBlur, error, hint, disabled, autoFocus, name },
  ref,
) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div
        className={cn(
          'flex h-12 items-stretch overflow-hidden rounded-control border-2 bg-white focus-within:border-blue-700',
          error ? 'border-danger' : 'border-line',
        )}
      >
        <span className="flex items-center bg-blue-50 px-3 font-bold tabular-nums text-blue-900">
          +221
        </span>
        <input
          ref={ref}
          id={id}
          name={name}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="77 123 45 67"
          autoFocus={autoFocus}
          disabled={disabled}
          value={formatPhoneLocal(value)}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 9))}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className="w-full bg-transparent px-4 text-body tabular-nums text-ink outline-none placeholder:text-muted disabled:bg-blue-50"
        />
      </div>
    </Field>
  );
});
