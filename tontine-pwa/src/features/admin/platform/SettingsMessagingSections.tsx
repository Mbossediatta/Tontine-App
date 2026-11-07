import { Button, Card, CardTitle, Input, Textarea } from '@/components/ui';
import type { PlatformSettings } from '@/types';
import { useSaveSettings, type SectionProps } from './settingsState';

export function SmsSection({ settings, setSettings }: SectionProps) {
  const saveSms = useSaveSettings('sms');
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Fournisseur SMS</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Fournisseur"
          value={settings.sms.provider}
          onChange={(event) =>
            setSettings({ ...settings, sms: { ...settings.sms, provider: event.target.value } })
          }
        />
        <Input
          label="Nom de l’expéditeur"
          maxLength={11}
          value={settings.sms.senderName}
          onChange={(event) =>
            setSettings({ ...settings, sms: { ...settings.sms, senderName: event.target.value } })
          }
        />
      </div>
      <p className="text-small text-muted">
        Les identifiants de l’API Orange (client et clé secrète) se règlent dans les secrets du
        serveur, pas sur cette page.
      </p>
      <Button
        variant="blue"
        loading={saveSms.isPending}
        onClick={() => saveSms.mutate(settings.sms)}
      >
        Enregistrer le fournisseur
      </Button>
    </Card>
  );
}

export function AppSection({ settings, setSettings }: SectionProps) {
  const saveApp = useSaveSettings('app');
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Application et assistance</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Nom de l’application"
          value={settings.app.name}
          onChange={(event) =>
            setSettings({ ...settings, app: { ...settings.app, name: event.target.value } })
          }
        />
        <Input
          label="Téléphone du support"
          value={settings.app.supportPhone}
          onChange={(event) =>
            setSettings({
              ...settings,
              app: { ...settings.app, supportPhone: event.target.value },
            })
          }
        />
        <Textarea
          label="Conditions d’utilisation"
          rows={4}
          value={settings.app.termsText}
          onChange={(event) =>
            setSettings({ ...settings, app: { ...settings.app, termsText: event.target.value } })
          }
        />
        <Textarea
          label="Politique de confidentialité"
          rows={4}
          value={settings.app.privacyText}
          onChange={(event) =>
            setSettings({
              ...settings,
              app: { ...settings.app, privacyText: event.target.value },
            })
          }
        />
      </div>
      <p className="text-small text-muted">
        Version actuelle des conditions : {settings.app.termsVersion}. Si vous modifiez l’un de ces
        deux textes, tous les membres et administrateurs devront les accepter de nouveau à leur
        prochaine ouverture de l’application.
      </p>
      <Button
        variant="blue"
        loading={saveApp.isPending}
        onClick={() => saveApp.mutate(settings.app)}
      >
        Enregistrer l’application
      </Button>
    </Card>
  );
}

export function TemplatesSection(props: SectionProps) {
  return (
    <>
      <TemplatesCard {...props} section="templates" title="Modèles de messages (français)" />
      <TemplatesCard {...props} section="templatesWo" title="Modèles de messages (wolof)" />
    </>
  );
}

/**
 * Modèles d'une langue : rappel, retard, paiement reçu, cagnotte envoyée. Chaque membre les
 * reçoit dans sa langue ({prenom}, {montant}, {groupe}, {date} sont remplis par le serveur).
 */
function TemplatesCard({
  settings,
  setSettings,
  section,
  title,
}: SectionProps & { section: 'templates' | 'templatesWo'; title: string }) {
  const saveTemplates = useSaveSettings(section);
  const templates = settings[section];
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{title}</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(templates) as Array<keyof PlatformSettings['templates']>).map((key) => (
          <Textarea
            key={key}
            label={
              {
                reminder: 'Rappel avant échéance',
                late: 'Relance de retard',
                payment: 'Confirmation de paiement',
                payout: 'Avis de versement',
              }[key]
            }
            rows={3}
            value={templates[key]}
            onChange={(event) =>
              setSettings({
                ...settings,
                [section]: { ...templates, [key]: event.target.value },
              })
            }
          />
        ))}
      </div>
      <Button
        variant="blue"
        loading={saveTemplates.isPending}
        onClick={() => saveTemplates.mutate(templates)}
      >
        Enregistrer les modèles
      </Button>
    </Card>
  );
}
