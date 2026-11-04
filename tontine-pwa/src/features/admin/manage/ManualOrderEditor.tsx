import { useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { roundService } from '@/services';
import type { MemberView } from '@/types';

function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Ordre manuel par glisser-déposer (avec boutons haut/bas pour le tactile et le clavier). */
export function ManualOrderEditor({
  groupId,
  members,
}: {
  groupId: string;
  members: MemberView[];
}) {
  const [order, setOrder] = useState(members);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const save = useAction({
    action: (ids: string[]) => roundService.setManualOrder(groupId, ids),
    success: 'Ordre enregistré',
  });

  const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) setOrder((o) => move(o, dragIndex, index));
    setDragIndex(null);
  };

  const iconButton =
    'flex h-11 w-11 items-center justify-center rounded-control text-blue-700 hover:bg-blue-100 disabled:opacity-30';

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Ordre des bénéficiaires</CardTitle>
      <p className="text-label text-muted">
        Glissez les noms ou utilisez les flèches. Le premier reçoit la cagnotte au tour 1.
      </p>
      <ol className="flex flex-col gap-2">
        {order.map((member, index) => (
          <li
            key={member.membership.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, index)}
            onDragEnd={() => setDragIndex(null)}
            className={cn(
              'flex items-center gap-2 rounded-control border bg-white pl-2',
              dragIndex === index ? 'border-blue-700 opacity-60' : 'border-line',
            )}
          >
            <GripVertical className="h-5 w-5 cursor-grab text-muted" aria-hidden="true" />
            <span className="w-6 font-semibold tabular-nums text-blue-700">{index + 1}</span>
            <span className="flex-1 truncate text-ink">
              {fullName(member.user)}
              {member.shareCount > 1 ? ` · part ${member.shareNumber}` : ''}
            </span>
            <button
              type="button"
              className={iconButton}
              disabled={index === 0}
              onClick={() => setOrder((o) => move(o, index, index - 1))}
              aria-label={`Monter ${fullName(member.user)}${member.shareCount > 1 ? ` part ${member.shareNumber}` : ''}`}
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={iconButton}
              disabled={index === order.length - 1}
              onClick={() => setOrder((o) => move(o, index, index + 1))}
              aria-label={`Descendre ${fullName(member.user)}${member.shareCount > 1 ? ` part ${member.shareNumber}` : ''}`}
            >
              <ArrowDown className="h-5 w-5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <OnlineButton
        block
        loading={save.isPending}
        onClick={() => save.mutate(order.map((m) => m.membership.id))}
      >
        Enregistrer l’ordre
      </OnlineButton>
    </Card>
  );
}
