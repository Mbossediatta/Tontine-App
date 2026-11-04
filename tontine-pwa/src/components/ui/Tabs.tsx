import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}

/** Onglets horizontaux défilants (flèches gauche/droite). Le parent affiche le contenu. */
export function Tabs<T extends string>({ items, value, onChange, label }: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const nextIndex = (index + delta + items.length) % items.length;
    const next = items[nextIndex];
    if (next) {
      onChange(next.id);
      refs.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line"
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            id={`${baseId}-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'min-h-touch whitespace-nowrap border-b-3 px-3 text-body transition-colors duration-150',
              selected
                ? 'border-blue-700 font-bold text-blue-700'
                : 'border-transparent font-semibold text-muted hover:text-blue-700',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
