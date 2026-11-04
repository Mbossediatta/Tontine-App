import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * primary : action principale et argent (vert) · secondary : contour bleu ·
 * blue : navigation et administration · ghost : lien · danger : suppression ·
 * onBlue : action posée sur un en-tête bleu · outline : action discrète dans une liste (bordure grise) ·
 * warning : action liée aux retards (orange clair, comme le badge « En retard »).
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'blue' | 'ghost' | 'danger' | 'onBlue' | 'outline' | 'warning';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pleine largeur sur mobile, largeur naturelle à partir de 640 px. */
  block?: boolean;
  loading?: boolean;
  /** Texte affiché pendant le chargement (ex. « Paiement en cours… »). */
  loadingText?: string;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-green-700 text-white hover:bg-green-800 active:bg-green-800',
  secondary: 'border-2 border-blue-700 bg-white text-blue-700 hover:bg-blue-100',
  blue: 'bg-blue-700 text-white hover:bg-blue-900',
  ghost: 'bg-transparent text-blue-700 hover:bg-blue-100',
  danger: 'border-2 border-danger/30 bg-white text-danger hover:bg-danger-bg',
  onBlue: 'bg-white/15 text-white hover:bg-white/25',
  outline: 'border border-line bg-white text-ink hover:border-blue-700 hover:text-blue-700',
  warning: 'bg-warning-bg text-warning hover:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-12 px-5 text-body',
  sm: 'min-h-touch px-4 text-label',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    loadingText,
    icon,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-bold transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full sm:w-auto',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : icon}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});
