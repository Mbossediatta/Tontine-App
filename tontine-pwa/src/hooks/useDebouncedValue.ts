import { useEffect, useState } from 'react';

/**
 * Renvoie `value` seulement quand elle n'a plus changé depuis `delay` ms.
 * Sert à ne lancer une recherche qu'une fois la frappe terminée.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
