import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Filtres avancés : repliés derrière un bouton « Filtres » sur téléphone et tablette
 * (ils occupaient tout le premier écran), toujours visibles sur ordinateur.
 * `className` porte la grille des champs.
 */
export function CollapsibleFilters({
  activeCount,
  className,
  children,
}: {
  /** Nombre de filtres actifs, rappelé sur le bouton quand ils sont repliés. */
  activeCount: number;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-touch items-center justify-between gap-2 rounded-control border border-line bg-white px-4 text-label font-bold text-ink lg:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filtres
          {activeCount > 0 ? (
            <span className="rounded-pill bg-blue-700 px-2 text-small text-white">
              {activeCount}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn('h-5 w-5 transition-transform duration-150', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <div id={id} className={cn(open ? 'grid' : 'hidden', 'lg:grid', className)}>
        {children}
      </div>
    </div>
  );
}

/** Champ de recherche avec loupe et bouton pour effacer. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label = 'Rechercher',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-control border-2 border-line bg-white pl-10 pr-11 text-body text-ink placeholder:text-muted focus:border-blue-700 focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-ink"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** Nombre d'éléments correspondants, affiché à côté du libellé. */
  count?: number;
}

/** Filtres en pastilles (un seul choix) ; la rangée défile horizontalement sur mobile. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<FilterOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-page flex gap-2 overflow-x-auto px-page sm:-mx-page-sm sm:px-page-sm lg:mx-0 lg:flex-wrap lg:px-0"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-touch shrink-0 rounded-pill px-4 text-label font-bold transition-colors duration-150',
              active
                ? 'bg-blue-700 text-white'
                : 'border border-line bg-white text-ink hover:border-blue-700 hover:text-blue-700',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn('ml-1.5 tabular-nums', active ? 'text-blue-100' : 'text-muted')}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
