import { Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@/components/ui';

interface InviteShareProps {
  code: string;
  groupName: string;
}

function inviteLink(code: string): string {
  return `${window.location.origin}/rejoindre/${code}`;
}

/** Code et lien d'invitation, avec Copier et Partager (Web Share API, repli WhatsApp). */
export function InviteShare({ code, groupName }: InviteShareProps) {
  const link = inviteLink(code);
  const message = `Rejoignez ma tontine « ${groupName} » : ${link} (code ${code})`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible. Sélectionnez le lien manuellement.');
    }
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: groupName, text: message, url: link });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  };

  return (
    <Card tone="positive" className="flex flex-col gap-3">
      <div>
        <p className="text-label text-muted">Code d’invitation</p>
        <p className="font-display text-amount tracking-[0.2em] text-blue-900">{code}</p>
      </div>
      <p className="break-all rounded-control bg-white p-3 text-label text-ink">{link}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          block
          onClick={() => void copy()}
          icon={<Copy className="h-5 w-5" aria-hidden="true" />}
        >
          Copier
        </Button>
        <Button
          block
          onClick={() => void share()}
          icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
        >
          Partager
        </Button>
      </div>
    </Card>
  );
}
