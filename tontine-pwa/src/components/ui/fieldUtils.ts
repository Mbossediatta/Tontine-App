export function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export const controlClass =
  'h-12 w-full rounded-control border-2 bg-white px-4 text-body text-ink placeholder:text-muted focus:border-blue-700 focus:outline-none disabled:bg-blue-50 disabled:text-muted';
