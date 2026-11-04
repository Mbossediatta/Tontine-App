import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** white : carte standard · pot : carte cagnotte (une par écran) · positive · info. */
export type CardTone = 'white' | 'pot' | 'positive' | 'info';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  padded?: boolean;
  /** Carte cliquable : léger enfoncement à l'appui. */
  interactive?: boolean;
}

const TONES: Record<CardTone, string> = {
  white: 'bg-white shadow-card',
  pot: 'bg-green-300 shadow-card',
  positive: 'bg-green-100',
  info: 'bg-blue-100',
};

export function Card({
  tone = 'white',
  padded = true,
  interactive = false,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card text-ink',
        TONES[tone],
        padded && (tone === 'pot' ? 'p-5' : 'p-4'),
        interactive && 'transition-transform duration-150 active:scale-[0.99]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('font-sans text-card-title text-ink', className)}>{children}</h3>;
}

/** Titre de section (Baloo 2, bleu foncé). */
export function SectionTitle({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2 id={id} className={cn('text-section text-blue-900', className)}>
      {children}
    </h2>
  );
}
