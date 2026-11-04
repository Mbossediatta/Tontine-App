import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/** Champ texte du parcours de connexion : libellé au-dessus, 56 px de haut, erreur en dessous. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, className, ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] font-semibold text-auth-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          'h-14 rounded-[12px] border-2 bg-white px-4 text-[17px] font-medium text-auth-ink placeholder:font-normal placeholder:text-auth-muted focus:border-auth-primary focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-auth-primary',
          error ? 'border-auth-error' : 'border-auth-line',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-auth-error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
