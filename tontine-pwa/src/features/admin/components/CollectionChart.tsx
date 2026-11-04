import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardTitle } from '@/components/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatAmount, formatMonth } from '@/lib/format';
import type { MonthlyCollection } from '@/types';

/** Hauteur de la zone de tracé, en pixels. */
const PLOT_HEIGHT = 200;

/** Sur téléphone, seuls les derniers mois sont tracés (le tableau garde tout). */
const MOBILE_MONTHS = 3;

/** Collecté ÷ attendu en % (« — » si rien n'était attendu ce mois-là). */
function rateLabel({ expected, collected }: MonthlyCollection): string {
  return expected > 0 ? `${Math.round((collected / expected) * 100)} %` : '—';
}

/** « Juin », « Juil. » sous les colonnes. */
const monthShort = (iso: string) => format(new Date(iso), 'MMM', { locale: fr });

/** Pastille de légende : carré de couleur + libellé. */
function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-small text-muted">
      <span className={cn('h-3 w-3 rounded-[3px]', swatch)} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Collectes mensuelles : pour chaque mois, l'attendu (vert clair) à côté du
 * collecté (bleu), et le taux de recouvrement écrit au-dessus.
 *
 * - Le vert clair, peu contrasté, joue le rôle d'objectif : le taux écrit au-dessus
 *   de chaque mois et le tableau pour lecteurs d'écran donnent les chiffres exacts.
 * - Survol (ou appui sur mobile) d'un mois : infobulle avec les deux montants.
 * - Sous 640 px, le graphique se limite aux 3 derniers mois pour rester lisible.
 */
export function CollectionChart({ data: allMonths }: { data: MonthlyCollection[] }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const data = wide ? allMonths : allMonths.slice(-MOBILE_MONTHS);
  // Mois survolé ou touché (null : aucune infobulle).
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.expected, d.collected]));
  const barHeight = (amount: number) =>
    amount > 0 ? Math.max((amount / max) * PLOT_HEIGHT, 2) : 0;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Collectes mensuelles (FCFA)</CardTitle>
        <div className="flex items-center gap-4">
          <LegendItem swatch="bg-green-300" label="Attendu" />
          <LegendItem swatch="bg-blue-700" label="Collecté" />
        </div>
      </div>

      <div className="flex gap-1" onMouseLeave={() => setActive(null)} aria-hidden="true">
        {data.map((point, index) => {
          const isActive = active === index;
          return (
            // Toute la colonne réagit au survol : cible plus grande que les barres.
            <div
              key={point.month}
              className="relative flex flex-1 flex-col items-center"
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive(index)}
            >
              {/* Taux de recouvrement, posé au-dessus des barres. */}
              <span className="mb-2 text-small tabular-nums text-ink">{rateLabel(point)}</span>

              <div
                className={cn(
                  'flex w-full items-end justify-center gap-0.5 rounded-t-[4px] border-b-2 border-line transition-colors duration-150 sm:gap-1',
                  isActive && 'bg-blue-50',
                )}
                style={{ height: PLOT_HEIGHT }}
              >
                <div
                  className="w-full max-w-6 rounded-t-[4px] bg-green-300"
                  style={{ height: barHeight(point.expected) }}
                />
                <div
                  className="w-full max-w-6 rounded-t-[4px] bg-blue-700"
                  style={{ height: barHeight(point.collected) }}
                />
              </div>

              <span className="mt-2 text-small capitalize text-muted">
                {monthShort(point.month)}
              </span>

              {isActive ? (
                <div
                  className={cn(
                    'pointer-events-none absolute top-6 z-10 whitespace-nowrap rounded-control bg-white px-3 py-2 text-small shadow-float',
                    // Les infobulles des bords s'alignent vers l'intérieur pour ne pas déborder.
                    index === 0
                      ? 'left-0'
                      : index === data.length - 1
                        ? 'right-0'
                        : 'left-1/2 -translate-x-1/2',
                  )}
                >
                  <span className="block capitalize text-muted">{formatMonth(point.month)}</span>
                  <span className="block tabular-nums text-ink">
                    Attendu : {formatAmount(point.expected)}
                  </span>
                  <span className="block font-bold tabular-nums text-ink">
                    Collecté : {formatAmount(point.collected)} ({rateLabel(point)})
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/*
        Version tableau pour les lecteurs d'écran. `sr-only` est posé sur un div :
        appliqué directement à un <table>, il ne réduit pas sa largeur (débordement sur mobile).
      */}
      <div className="sr-only">
        <table>
          <caption>Collectes mensuelles, attendu et collecté</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">Attendu</th>
              <th scope="col">Collecté</th>
              <th scope="col">Taux</th>
            </tr>
          </thead>
          <tbody>
            {allMonths.map((point) => (
              <tr key={point.month}>
                <td>{formatMonth(point.month)}</td>
                <td>{formatAmount(point.expected)}</td>
                <td>{formatAmount(point.collected)}</td>
                <td>{rateLabel(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
