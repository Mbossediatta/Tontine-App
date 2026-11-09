import { cn } from '@/lib/cn';

type GroupPhotoSize = 'sm' | 'md' | 'lg';

interface GroupPhotoProps {
  name: string;
  src?: string;
  size?: GroupPhotoSize;
  className?: string;
}

const SIZES: Record<GroupPhotoSize, string> = {
  sm: 'h-10 w-10 rounded-lg text-small',
  md: 'h-12 w-12 rounded-xl text-body',
  lg: 'h-20 w-20 rounded-2xl text-page-title',
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Photo ou logo d'un groupe : carré aux coins arrondis (les personnes ont un rond).
 * Sans photo, les initiales du groupe. Décoratif : le nom est toujours écrit à côté.
 */
export function GroupPhoto({ name, src, size = 'md', className }: GroupPhotoProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-blue-100 font-bold text-blue-700',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initialsOf(name) || '?'
      )}
    </span>
  );
}
