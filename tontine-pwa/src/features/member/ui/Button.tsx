import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * primary : LE bouton principal de l'écran (un seul par écran), bleu plein.
 * secondary : contour fin, pour une action d'appoint.
 * quiet : texte bleu sans fond (lien d'action).
 */
export type MemberButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface MemberButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: MemberButtonVariant;
  /** Envoi en cours : roue dans le bouton, bouton inactif. */
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANTS: Record<MemberButtonVariant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-300',
  secondary:
    'border border-slate-300 bg-white text-slate-900 hover:border-blue-700 hover:text-blue-700 active:bg-slate-50',
  quiet: 'text-blue-700 hover:bg-blue-50 active:bg-blue-100',
};

/** Bouton de l'espace membre : 48 px de haut, coins de 8 px, retour visuel au toucher. */
export const Button = forwardRef<HTMLButtonElement, MemberButtonProps>(function Button(
  {
    variant = 'primary',
    loading = false,
    icon,
    block = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed',
        variant !== 'primary' && 'disabled:opacity-50',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});
