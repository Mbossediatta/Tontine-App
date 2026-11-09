import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import { useT, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { GUIDES, type GuideId } from './guideSteps';

/**
 * Guide de découverte de l'espace membre : la première fois qu'une page s'ouvre, l'écran
 * s'assombrit et une bulle présente chaque partie de la page, l'une après l'autre
 * (« Suivant », « Retour », « Passer »). Il s'ouvre seul la première fois, puis le bouton
 * « ? », présent sur chaque page au même endroit, le relance à tout moment.
 *
 * Les parties sont repérées par l'attribut `data-guide="…"`. Une étape dont la partie
 * n'est pas à l'écran (ex. aucune cotisation à payer) est simplement sautée.
 */

const STORAGE_KEY = 'calebasse.guide.v1';

function seenGuides(): GuideId[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? (value as GuideId[]) : [];
  } catch {
    return [];
  }
}

function markSeen(id: GuideId): void {
  try {
    const seen = seenGuides();
    if (!seen.includes(id)) window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen, id]));
  } catch {
    // Stockage indisponible : le guide se remontrera à la prochaine visite, sans gêne.
  }
}

/** La partie visible marquée `data-guide="name"` (la barre du bas ou le menu de côté). */
function findTarget(name: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

/** Une autre fenêtre est ouverte (conditions d'utilisation, partage…) : on attend. */
function otherDialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]:not([data-guide-dialog])') !== null;
}

interface Step {
  target?: string;
  title: MessageKey;
  text: MessageKey;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const MARGIN = 6; // espace autour de la partie éclairée
const BUBBLE_ROOM = 230; // hauteur à prévoir pour placer la bulle au-dessus ou en dessous

/**
 * À placer dans une page de l'espace membre. `ready` : la page affiche son vrai contenu
 * (et non un chargement), pour que le guide montre ce que la personne verra.
 */
export function PageGuide({ id, ready = true }: { id: GuideId; ready?: boolean }) {
  const { t } = useT();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);

  /** Ouvre le guide sur les parties présentes à l'écran ; false s'il n'y en a aucune. */
  const start = useCallback((): boolean => {
    const available = GUIDES[id].filter((step) => !step.target || findTarget(step.target));
    if (available.length === 0) return false;
    markSeen(id);
    setIndex(0);
    setSteps(available);
    return true;
  }, [id]);

  // Première visite de la page : le guide s'ouvre seul, une fois la page prête et
  // aucune autre fenêtre ouverte. Il compte comme vu dès qu'il s'affiche.
  useEffect(() => {
    if (!ready || seenGuides().includes(id)) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 60) window.clearInterval(timer); // 30 s sans occasion : ce sera pour la prochaine fois
      if (otherDialogOpen() || document.visibilityState !== 'visible') return;
      window.clearInterval(timer);
      start();
    }, 500);
    return () => window.clearInterval(timer);
  }, [id, ready, start]);

  return (
    <>
      {/* Place en bas de page (téléphone) : le contenu peut défiler au-dessus du « ? »
          au lieu de rester caché dessous. */}
      <div aria-hidden="true" className="h-12 lg:hidden" />
      {/* Bouton « ? » : même place sur chaque page, au-dessus de la barre du bas (et du
          bouton d'action quand l'écran en a un), à droite, à portée de pouce. */}
      {createPortal(
        <button
          type="button"
          onClick={start}
          aria-label={t('guide.help')}
          title={t('guide.help')}
          className={cn(
            'theme-member fixed right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-700 shadow-md hover:bg-blue-50 active:bg-blue-100',
            'bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-6 lg:right-6',
            'guide-help',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700',
          )}
        >
          <CircleHelp className="h-6 w-6" aria-hidden="true" />
        </button>,
        document.body,
      )}
      {steps ? (
        <GuideOverlay
          steps={steps}
          index={index}
          onIndex={setIndex}
          onClose={() => setSteps(null)}
        />
      ) : null}
    </>
  );
}

function GuideOverlay({
  steps,
  index,
  onIndex,
  onClose,
}: {
  steps: Step[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const step = steps[index] ?? steps[0];
  const [box, setBox] = useState<Box | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const last = index === steps.length - 1;

  // La partie présentée est amenée au milieu de l'écran, puis suivie (défilement,
  // rotation du téléphone) pour que l'éclairage reste dessus.
  useLayoutEffect(() => {
    const element = step?.target ? findTarget(step.target) : null;
    if (!element) {
      setBox(null);
      return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    let frame = 0;
    const follow = () => {
      const rect = element.getBoundingClientRect();
      setBox((previous) =>
        previous &&
        previous.top === rect.top &&
        previous.left === rect.left &&
        previous.width === rect.width &&
        previous.height === rect.height
          ? previous
          : { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      );
      frame = window.requestAnimationFrame(follow);
    };
    follow();
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    primary.current?.focus();
  }, [index]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!step) return null;

  // Bulle sous la partie éclairée s'il y a la place, sinon au-dessus, sinon au centre.
  const viewport = window.innerHeight;
  let bubblePosition: React.CSSProperties = { top: '50%', transform: 'translateY(-50%)' };
  if (box) {
    if (viewport - (box.top + box.height) > BUBBLE_ROOM) {
      bubblePosition = { top: box.top + box.height + MARGIN + 10 };
    } else if (box.top > BUBBLE_ROOM) {
      bubblePosition = { bottom: viewport - box.top + MARGIN + 10 };
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      data-guide-dialog
      aria-modal="true"
      role="dialog"
      aria-labelledby="guide-title"
      aria-describedby="guide-text"
    >
      {/* Fond sombre : il bloque les appuis sur la page pendant le guide. */}
      {box ? (
        <>
          <div className="absolute inset-0" aria-hidden="true" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-xl ring-2 ring-white transition-all duration-200 ease-out motion-reduce:transition-none"
            style={{
              top: box.top - MARGIN,
              left: box.left - MARGIN,
              width: box.width + MARGIN * 2,
              height: box.height + MARGIN * 2,
              boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.68)',
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-slate-900/70" aria-hidden="true" />
      )}

      <div
        className="absolute inset-x-4 mx-auto max-w-[360px] rounded-xl bg-white p-4 text-slate-900 shadow-xl motion-safe:animate-fade-in"
        style={bubblePosition}
      >
        <p className="text-[12px] font-semibold text-blue-700">
          {t('guide.progress', { current: index + 1, total: steps.length })}
        </p>
        <h2 id="guide-title" className="mt-1 text-[16px] font-bold leading-6">
          {t(step.title)}
        </h2>
        <p id="guide-text" className="mt-1 text-[14px] leading-5 text-slate-700">
          {t(step.text)}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {!last ? (
            <button
              type="button"
              onClick={close}
              className="min-h-[44px] rounded-lg px-2 text-[14px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              {t('guide.skip')}
            </button>
          ) : null}
          <span className="flex-1" />
          {index > 0 ? (
            <button
              type="button"
              onClick={() => onIndex(index - 1)}
              className="min-h-[44px] rounded-lg px-3 text-[14px] font-semibold text-blue-700 hover:bg-blue-50"
            >
              {t('guide.back')}
            </button>
          ) : null}
          <button
            ref={primary}
            type="button"
            onClick={() => (last ? close() : onIndex(index + 1))}
            className={cn(
              'min-h-[44px] rounded-lg bg-blue-700 px-4 text-[14px] font-semibold text-white hover:bg-blue-800',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700',
            )}
          >
            {last ? t('guide.done') : t('guide.next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
