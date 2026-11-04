import { useId } from 'react';
import { cn } from '@/lib/cn';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Interrupteur on/off (vert quand activé). */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex min-h-touch items-center justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-body font-semibold text-ink">
          {label}
        </label>
        {description ? <span className="text-small text-muted">{description}</span> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill transition-colors duration-150 disabled:opacity-50',
          checked ? 'bg-green-700' : 'bg-line',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-150',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
