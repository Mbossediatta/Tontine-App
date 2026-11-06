import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Button, Card, CardTitle, Input, Select, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { queryKeys, useAction } from '@/lib/query';
import { communicationService, groupService } from '@/services';
import { PageFrame, QueryState, Stat } from './PlatformUi';

const smsKindLabels = {
  otp: 'Connexion',
  reminder: 'Rappels',
  announcement: 'Annonces',
  payment: 'Paiements',
  payout: 'Versements',
} as const;

export function AnnouncementsPage() {
  const [targetKind, setTargetKind] = useState<'all' | 'admins' | 'group'>('all');
  const [groupId, setGroupId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState('30');
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const sms = useQuery({
    queryKey: ['admin', 'sms-stats', days],
    queryFn: () => communicationService.smsStats(Number(days)),
  });
  const send = useAction({
    action: () =>
      communicationService.announce(
        targetKind === 'group' ? { kind: 'group', groupId } : { kind: targetKind },
        title,
        message,
      ),
    success: (count) => `Annonce envoyée à ${count} destinataire${count > 1 ? 's' : ''}`,
    onSuccess: () => {
      setTitle('');
      setMessage('');
    },
  });
  return (
    <PageFrame
      title="Notifications et annonces"
      subtitle="Diffusez un message ciblé et suivez les SMS envoyés."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="flex flex-col gap-4">
          <CardTitle>Nouvelle annonce</CardTitle>
          <Select
            label="Destinataires"
            value={targetKind}
            onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}
            options={[
              { value: 'all', label: 'Toute la plateforme' },
              { value: 'admins', label: 'Tous les administrateurs' },
              { value: 'group', label: 'Membres d’un groupe' },
            ]}
          />
          {targetKind === 'group' ? (
            <Select
              label="Groupe"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              options={(groups.data ?? []).map(({ group }) => ({
                value: group.id,
                label: group.name,
              }))}
              placeholder="Sélectionner un groupe"
            />
          ) : null}
          <Input
            label="Titre"
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            label="Message"
            value={message}
            maxLength={500}
            rows={5}
            onChange={(event) => setMessage(event.target.value)}
            hint="Le message sera envoyé dans l’application et par SMS."
          />
          <Button
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
            loading={send.isPending}
            disabled={!title.trim() || !message.trim() || (targetKind === 'group' && !groupId)}
            onClick={() => send.mutate()}
          >
            Envoyer l’annonce
          </Button>
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Suivi des SMS</CardTitle>
              <p className="mt-1 text-label text-muted">Nombre de messages envoyés, par type.</p>
            </div>
            <Select
              label="Période"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              options={[
                { value: '7', label: '7 derniers jours' },
                { value: '30', label: '30 derniers jours' },
                { value: '90', label: '90 derniers jours' },
              ]}
            />
          </div>
          <QueryState query={sms}>
            {sms.data ? (
              <>
                {/* Pas de coût affiché : le tarif dépend du contrat Orange (voir la facture). */}
                <Stat label="SMS envoyés" value={sms.data.count} />
                <ul className="divide-y divide-line">
                  {sms.data.byKind.map((item) => (
                    <li key={item.kind} className="flex justify-between gap-3 py-2">
                      <span>{smsKindLabels[item.kind]}</span>
                      <span className="tabular-nums text-muted">{item.count}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="font-bold">Envois récents</h3>
                <ul className="max-h-64 divide-y divide-line overflow-auto">
                  {sms.data.recent.map((item) => (
                    <li key={item.id} className="flex justify-between gap-2 py-2 text-small">
                      <span>
                        {item.name ?? item.phone} · {smsKindLabels[item.kind]}
                      </span>
                      <span className="shrink-0 text-muted">{formatDateTime(item.at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </QueryState>
        </Card>
      </div>
    </PageFrame>
  );
}
