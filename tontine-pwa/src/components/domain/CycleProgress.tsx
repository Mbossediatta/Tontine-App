import { ProgressBar } from '@/components/ui';

/** Barre « Tour 3 / 10 ». */
export function CycleProgress({ current, total }: { current: number; total: number }) {
  return <ProgressBar value={current} max={total} label={`Tour ${current} / ${total}`} />;
}
