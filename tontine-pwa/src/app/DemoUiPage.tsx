import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AmountText, RoundProgress, StatusBadge } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Logo,
  Modal,
  OtpInput,
  PhoneInput,
  ProgressBar,
  SectionTitle,
  Select,
  Skeleton,
  Stepper,
  Tabs,
  Textarea,
  Toggle,
} from '@/components/ui';
import { PaymentMethodPicker, type OnlineMethod } from '@/features/payments/PaymentMethodPicker';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{title}</SectionTitle>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}

/** Vitrine de tous les composants et variantes (mode démonstration uniquement). */
export default function DemoUiPage() {
  const [phone, setPhone] = useState('771234567');
  const [otp, setOtp] = useState('12');
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [toggle, setToggle] = useState(true);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<OnlineMethod | null>('wave');

  return (
    <main className="mx-auto flex max-w-admin flex-col gap-6 bg-blue-50 px-page py-6 sm:px-page-sm">
      <PageHeader title="Composants d’interface" subtitle="Calebasse de l’Espoir · DESIGN-UI.md" />

      <Section title="Logo">
        <div className="flex items-center gap-4">
          <Logo size={96} />
          <span className="font-display text-page-title text-blue-900">Calebasse de l’Espoir</span>
        </div>
      </Section>

      <Section title="Boutons">
        <div className="flex flex-wrap gap-2">
          <Button>Payer 4 500 FCFA</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="blue">Bleu</Button>
          <Button variant="ghost">Fantôme</Button>
          <Button variant="danger">Supprimer</Button>
          <Button loading loadingText="Paiement en cours…">
            Payer
          </Button>
          <Button disabled>Désactivé</Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
            Petit
          </Button>
        </div>
        <div className="flex gap-2 rounded-control bg-blue-700 p-3">
          <Button variant="onBlue" size="sm">
            Sur fond bleu
          </Button>
        </div>
      </Section>

      <Section title="Champs">
        <Input label="Nom du groupe" placeholder="Tontine Famille" />
        <Input label="Avec erreur" error="Le nom doit contenir au moins 3 caractères" />
        <Textarea label="Description" hint="Facultatif" />
        <Select
          label="Fréquence"
          options={[
            { value: 'm', label: 'Mensuelle' },
            { value: 'w', label: 'Hebdomadaire' },
          ]}
        />
        <PhoneInput label="Téléphone" value={phone} onChange={setPhone} />
        <OtpInput value={otp} onChange={setOtp} />
        <Toggle
          label="Rappels de cotisation"
          description="Avant chaque date limite"
          checked={toggle}
          onChange={setToggle}
        />
        <PaymentMethodPicker value={method} onChange={setMethod} />
      </Section>

      <Section title="Badges et montants">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="paid" />
          <StatusBadge status="pending" />
          <StatusBadge status="late" />
          <StatusBadge status="failed" />
          <StatusBadge status="my_turn" />
          <StatusBadge status="admin" />
          <Badge tone="info">Information</Badge>
          <Badge>Brouillon</Badge>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <AmountText value={45000} tone="due" size="main" />
          <AmountText value={45000} tone="received" size="main" />
          <AmountText value={4500} size="secondary" />
        </div>
      </Section>

      <Section title="Cartes">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card tone="pot">
            <p className="text-label">Carte cagnotte</p>
            <AmountText value={45000} tone="due" size="main" />
          </Card>
          <Card>Carte blanche</Card>
          <Card tone="positive">Encart positif</Card>
          <Card tone="info">Information</Card>
        </div>
      </Section>

      <Section title="Progression et onglets">
        <RoundProgress paid={7} total={10} />
        <ProgressBar value={3} max={10} label="Tour 3 / 10" />
        <Stepper
          steps={['Informations', 'Règles', 'Attribution', 'Récapitulatif']}
          current={step}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Précédent
          </Button>
          <Button size="sm" onClick={() => setStep((s) => Math.min(3, s + 1))}>
            Suivant
          </Button>
        </div>
        <Tabs
          label="Démo"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'a', label: 'Tour' },
            { id: 'b', label: 'Calendrier' },
            { id: 'c', label: 'Membres' },
          ]}
        />
        <div className="flex items-center">
          {['Awa Fall', 'Moussa Diop', 'Khady Ba', 'Cheikh Mbaye'].map((name, index) => (
            <Avatar key={name} name={name} index={index} ringed className="-ml-2 first:ml-0" />
          ))}
          <Avatar name="Aïssatou Diallo" size="lg" className="ml-4" />
        </div>
      </Section>

      <Section title="Fenêtres et notifications">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal(true)}>
            Ouvrir une modale
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Confirmation
          </Button>
          <Button variant="secondary" onClick={() => toast.success('Paiement confirmé')}>
            Toast succès
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Code incorrect')}>
            Toast erreur
          </Button>
          <Button variant="secondary" onClick={() => toast.info('Nouveau tour ouvert')}>
            Toast info
          </Button>
        </div>
      </Section>

      <Section title="États">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full rounded-card" />
        <EmptyState
          title="Vous n’avez pas encore de groupe"
          description="Rejoignez un groupe avec un code."
          action={<Button className="w-full">Rejoindre un groupe</Button>}
        />
        <ErrorState onRetry={() => toast.info('Nouvel essai')} />
      </Section>

      <Modal open={modal} onClose={() => setModal(false)} title="Exemple de modale">
        Contenu de la fenêtre.
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        title="Supprimer le groupe ?"
        confirmLabel="Supprimer"
        tone="danger"
        confirmText="Tontine Famille"
      >
        Cette action est définitive.
      </ConfirmDialog>
    </main>
  );
}
