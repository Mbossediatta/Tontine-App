import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  actions?: ReactNode;
  /** Contenu supplémentaire dans le bandeau (ex. montant de la cagnotte). */
  children?: ReactNode;
  /**
   * `true` : grand titre bleu foncé sur le fond de la page, comme les tableaux de bord
   * (écrans d'administration). Par défaut : bandeau bleu, texte blanc (participants).
   */
  plain?: boolean;
}

/** Bouton « Retour » : flèche dans un carré de 44 px, couleur adaptée au fond. */
function BackLink({ to, plain }: { to: string; plain: boolean }) {
  return (
    <Link
      to={to}
      aria-label="Retour"
      className={
        plain
          ? '-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-blue-900 hover:bg-blue-100'
          : '-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control hover:bg-white/15'
      }
    >
      <ArrowLeft className="h-6 w-6" aria-hidden="true" />
    </Link>
  );
}

/**
 * En-tête de page, en deux styles :
 * - bandeau bleu, texte blanc : bord à bord sur mobile, carte arrondie sur grand écran ;
 *   les boutons placés dans `actions` doivent alors être lisibles sur fond bleu ;
 * - `plain` : titre bleu foncé sans bandeau, actions à droite (sous le titre sur mobile).
 */
export function PageHeader({
  title,
  subtitle,
  backTo,
  actions,
  children,
  plain = false,
}: PageHeaderProps) {
  if (plain) {
    return (
      <header className="mb-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {backTo ? <BackLink to={backTo} plain /> : null}
          <div className="min-w-0">
            <h1 className="font-display text-page-title text-blue-900">{title}</h1>
            {subtitle ? <div className="mt-1 text-body text-muted">{subtitle}</div> : null}
            {children ? <div className="mt-2">{children}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
    );
  }

  return (
    <header className="-mx-page -mt-4 mb-4 bg-blue-700 px-page pb-4 pt-3 text-white sm:-mx-page-sm sm:px-page-sm lg:mx-0 lg:mt-0 lg:rounded-card lg:px-6">
      <div className="flex min-h-[44px] items-center gap-2">
        {backTo ? <BackLink to={backTo} plain={false} /> : null}
        <h1 className="min-w-0 flex-1 truncate font-display text-section text-white">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {subtitle ? <div className="mt-1 text-body text-blue-100">{subtitle}</div> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </header>
  );
}
