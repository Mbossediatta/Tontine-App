import { cn } from '@/lib/cn';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Position dans une liste : alterne bleu et vert clair. Par défaut, déduite du nom. */
  index?: number;
  /** Bordure blanche pour les avatars superposés. */
  ringed?: boolean;
  className?: string;
}

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-small',
  md: 'h-11 w-11 text-body',
  lg: 'h-20 w-20 text-page-title',
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function hashOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % 997;
  return hash;
}

/** Cercle avec initiales ou photo. Décoratif : le nom est toujours écrit à côté. */
export function Avatar({ name, src, size = 'md', index, ringed, className }: AvatarProps) {
  const blue = (index ?? hashOf(name)) % 2 === 0;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        blue ? 'bg-blue-700 text-white' : 'bg-green-300 text-ink',
        ringed && 'border-3 border-white',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
