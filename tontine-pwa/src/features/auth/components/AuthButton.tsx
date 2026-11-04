import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Envoi en cours : roue dans le bouton, et bouton inactif. */
  loading?: boolean;
  children: ReactNode;
}

/** Bouton principal du parcours : bleu de la charte, 56 px de haut, pleine largeur. */
export function AuthButton({
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: AuthButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'flex h-14 w-full items-center justify-center gap-2 rounded-[12px] bg-auth-primary px-5 text-[16px] font-semibold text-white transition-colors duration-150 hover:bg-auth-primary-hover focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:bg-[#A7BCDD] disabled:hover:bg-[#A7BCDD]',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

interface AuthLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary : lien bleu (« Code PIN oublié ? ») · muted : lien discret, gris (« Changer de compte »). */
  tone?: 'primary' | 'muted';
}

/** Lien d'action (« Modifier le numéro », « Code PIN oublié ? »), au moins 44 px de haut. */
export function AuthLink({ tone = 'primary', className, ...rest }: AuthLinkProps) {
  return (
    <button
      type="button"
      className={cn(
        'min-h-[44px] rounded-[8px] px-2 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60',
        tone === 'primary'
          ? 'text-[15px] font-semibold text-auth-primary hover:text-auth-primary-hover'
          : 'text-[14px] font-medium text-auth-muted hover:text-auth-ink',
        className,
      )}
      {...rest}
    />
  );
}

/** Message d'erreur sobre, annoncé aux lecteurs d'écran. */
export function AuthError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-center text-[14px] font-medium leading-5 text-auth-error">
      {children}
    </p>
  );
}
