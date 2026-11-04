import type { ReactNode } from 'react';
import { CalendarCheck, ShieldCheck, Smartphone } from 'lucide-react';
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

const HIGHLIGHTS = [
  { icon: Smartphone, text: 'Cotisez en quelques secondes avec Wave ou Orange Money.' },
  { icon: CalendarCheck, text: 'Suivez chaque tour : qui a payé, qui reçoit, et quand.' },
  { icon: ShieldCheck, text: 'Votre compte est protégé par un code PIN personnel.' },
] as const;

/**
 * Panneau de présentation, à gauche sur ordinateur (≥ 1024 px) : il occupe la place
 * qui restait vide autour de la carte. Masqué sur téléphone et tablette.
 */
function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between bg-auth-primary p-12 text-white lg:flex xl:p-16">
      {/* Le logo (texte bleu et vert) est posé sur une plaque blanche pour rester lisible. */}
      <div className="w-fit rounded-[16px] bg-white px-5 py-3">
        <BrandLogo className="max-w-[170px]" />
      </div>
      <div className="max-w-[460px]">
        <p className="text-[34px] font-bold leading-[42px]">
          Votre tontine, simple et transparente.
        </p>
        <ul className="mt-8 flex flex-col gap-5">
          {HIGHLIGHTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-4 text-[17px] leading-7">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[14px] text-white/80">Calebasse de l’Espoir · Tontines en FCFA</p>
    </aside>
  );
}

/**
 * Mise en page commune aux écrans de connexion (charte du parcours de connexion) :
 * fond gris très clair, carte blanche de 420 px au plus, logo complet de l'application,
 * titre et phrase centrés. Chaque écran arrive par un court glissement.
 *
 * Sur téléphone, le contenu est collé en haut (rien n'est caché quand le clavier
 * s'ouvre) ; sur tablette, la carte est centrée dans la page ; sur ordinateur, la page
 * passe sur deux colonnes : présentation bleue à gauche, formulaire à droite.
 */
export function AuthScreen({ title, subtitle, step, children, below }: AuthScreenProps) {
  return (
    <main
      className={cn(
        'min-h-[100dvh] bg-auth-page font-jakarta text-auth-ink lg:grid lg:grid-cols-2',
        // Focus bien visible, dans le bleu de la charte (contraste ≥ 3:1).
        '[&_:focus-visible]:outline-auth-primary',
      )}
    >
      <BrandPanel />
      <div className="flex min-h-[100dvh] flex-col items-center px-4 py-6 sm:justify-center sm:py-10">
        <div className="w-full max-w-[420px]">
          {step ? <Progress {...step} /> : null}
          <section className="rounded-[16px] bg-white px-5 py-7 shadow-[0_1px_2px_rgba(19,35,58,0.06)] motion-safe:animate-slide-in sm:px-8">
            {/* Sur ordinateur, le logo est déjà dans le panneau de gauche. */}
            <BrandLogo className="mx-auto mb-5 max-w-[190px] lg:hidden" />
            <h1 className="text-center font-jakarta text-[24px] font-bold leading-8 text-auth-ink">
              {title}
            </h1>
            {subtitle ? (
              <div className="mt-2 text-center text-[15px] leading-6 text-auth-muted">
                {subtitle}
              </div>
            ) : null}
            <div className="mt-7">{children}</div>
          </section>
          {below ? <div className="mt-6">{below}</div> : null}
        </div>
      </div>
    </main>
  );
}
