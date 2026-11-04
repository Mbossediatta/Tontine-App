import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'admin' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-green-100 text-green-700',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-blue-100 text-blue-700',
  admin: 'bg-blue-700 text-white',
  neutral: 'bg-blue-50 text-muted',
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Badge en pilule ; toujours accompagné d'un texte. */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-small font-bold',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
