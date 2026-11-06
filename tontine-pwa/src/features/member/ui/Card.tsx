import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Carte : fond blanc, bordure fine, coins de 12 px, pas d'ombre. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white', className)} {...rest} />;
}

/** Titre de section, avec une action discrète à droite (« Tout voir »). */
export function SectionHeader({
  title,
  action,
  id,
}: {
  title: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold text-slate-900">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** Titre de page : une ligne, la taille « titre » de l'échelle (18 px). */
export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex min-h-[48px] items-center justify-between gap-3">
      <h1 className="text-[18px] font-bold leading-6 text-slate-900">{children}</h1>
      {aside}
    </header>
  );
}
