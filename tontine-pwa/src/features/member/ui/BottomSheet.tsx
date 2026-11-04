import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Feuille qui monte du bas de l'écran (sur ordinateur : fenêtre centrée).
 * Se ferme avec Échap, le bouton ✕ ou un appui sur le fond ; le focus est placé dans
 * la feuille à l'ouverture et rendu à l'élément d'origine à la fermeture.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    // La page derrière ne défile plus tant que la feuille est ouverte.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="theme-member fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/40 motion-safe:animate-fade-in"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[88vh] w-full max-w-md flex-col rounded-t-xl bg-white outline-none motion-safe:animate-sheet-up sm:rounded-xl sm:motion-safe:animate-fade-in"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Poignée : indique sur téléphone que la feuille vient du bas. */}
        <span className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-2 sm:pt-4">
          <h2 id={titleId} className="text-[18px] font-bold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
