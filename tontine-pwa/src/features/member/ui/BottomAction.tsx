import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Action principale d'un écran, posée en bas, juste au-dessus de la barre de
 * navigation : là où tombe le pouce, comme dans Wave ou les applications bancaires.
 * Sur ordinateur (≥ 1024 px, sans barre du bas), elle reprend sa place dans la page.
 * À placer en dernier dans l'écran : elle réserve elle-même la place sous le contenu,
 * pour que le dernier élément ne passe pas sous le bouton.
 */
export function BottomAction({ children }: { children: ReactNode }) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  if (desktop) return <div>{children}</div>;
  return (
    <>
      <div aria-hidden="true" className="h-16" />
      {/* Rendu au niveau de la page : l'animation d'entrée de l'écran (transform)
          empêcherait sinon le bouton de rester collé en bas. */}
      {createPortal(
        <div className="theme-member fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20">
          {/* Léger fondu : le contenu qui défile disparaît sous le bouton sans trait dur. */}
          <div className="mx-auto max-w-participant bg-gradient-to-t from-blue-50 via-blue-50/95 to-blue-50/0 px-page pb-3 pt-6 sm:px-page-sm">
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
