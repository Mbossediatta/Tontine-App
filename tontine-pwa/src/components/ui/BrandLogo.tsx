import { cn } from '@/lib/cn';

interface BrandLogoProps {
  /** full : logo complet avec le nom · mark : emblème seul (calebasse), pour les petits espaces. */
  variant?: 'full' | 'mark';
  className?: string;
}

/**
 * Logo officiel « Calebasse de l'Espoir » (images tirées du fichier fourni par le client,
 * recadrées et allégées dans public/brand/). Les dimensions sont fixées pour éviter que
 * la page ne saute pendant le chargement de l'image.
 */
export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  return variant === 'full' ? (
    <img
      src="/brand/logo.png"
      alt="Calebasse de l’Espoir"
      width={480}
      height={207}
      className={cn('h-auto w-full', className)}
    />
  ) : (
    <img
      src="/brand/logo-mark.png"
      alt="Calebasse de l’Espoir"
      width={144}
      height={144}
      className={cn('h-10 w-10', className)}
    />
  );
}
