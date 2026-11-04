import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { cn } from '@/lib/cn';

export interface AuthStep {
  current: number;
  total: number;
}

interface AuthScreenProps {
  title: string;
  subtitle?: ReactNode;
  /** Barre de progression (première inscription uniquement). */
  step?: AuthStep;
  children: ReactNode;
  /** Contenu discret sous la carte (ex. comptes de démonstration). */
  below?: ReactNode;
}

/** Barre de progression discrète : « Étape 1 sur 3 » et un trait qui se remplit. */
function Progress({ current, total }: AuthStep) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <p className="text-[13px] font-medium text-auth-muted">
        Étape {current} sur {total}
      </p>
      <div
        role="progressbar"
        aria-label="Progression de l’inscription"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        className="h-1 overflow-hidden rounded-full bg-[#E3EAF2]"
      >
        <div
          className="h-full rounded-full bg-auth-primary transition-[width] duration-200"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Mise en page commune aux écrans de connexion (charte du parcours de connexion) :
 * fond gris très clair, carte blanche de 420 px au plus, logo complet de l'application,
 * titre et phrase centrés. Chaque écran arrive par un court glissement.
 *
 * Sur téléphone, le contenu est collé en haut (rien n'est caché quand le clavier
 * s'ouvre) ; sur ordinateur, la carte est centrée dans la page.
 */
export function AuthScreen({ title, subtitle, step, children, below }: AuthScreenProps) {
  return (
    <main
      className={cn(
        'flex min-h-[100dvh] flex-col items-center bg-auth-page px-4 py-6 font-jakarta text-auth-ink sm:justify-center sm:py-10',
        // Focus bien visible, dans le bleu de la charte (contraste ≥ 3:1).
        '[&_:focus-visible]:outline-auth-primary',
      )}
    >
      <div className="w-full max-w-[420px]">
        {step ? <Progress {...step} /> : null}
        <section className="rounded-[16px] bg-white px-5 py-7 shadow-[0_1px_2px_rgba(19,35,58,0.06)] motion-safe:animate-slide-in sm:px-8">
          <BrandLogo className="mx-auto mb-5 max-w-[190px]" />
          <h1 className="text-center font-jakarta text-[24px] font-bold leading-8 text-auth-ink">
            {title}
          </h1>
          {subtitle ? (
            <div className="mt-2 text-center text-[15px] leading-6 text-auth-muted">{subtitle}</div>
          ) : null}
          <div className="mt-7">{children}</div>
        </section>
        {below ? <div className="mt-6">{below}</div> : null}
      </div>
    </main>
  );
}
