import { Button, Card, CardTitle, Input, Textarea } from '@/components/ui';
import type { PlatformSettings } from '@/types';
import { numberUpdater, useSaveSettings, type SectionProps } from './settingsState';

export function SmsSection({ settings, setSettings }: SectionProps) {
  const saveSms = useSaveSettings('sms');
  const updateNumber = numberUpdater(setSettings);
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
        <Input
          label="Clé API"
          type="password"
          autoComplete="new-password"
          value={settings.sms.apiKey}
          onChange={(event) =>
            setSettings({ ...settings, sms: { ...settings.sms, apiKey: event.target.value } })
          }
        />
        <Input
          label="Coût par SMS (FCFA)"
          type="number"
          min="0"
          value={settings.sms.costPerSms}
          onChange={(event) => updateNumber('sms', 'costPerSms', event.target.value)}
        />
      </div>
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

export function TemplatesSection({ settings, setSettings }: SectionProps) {
  const saveTemplates = useSaveSettings('templates');
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Modèles de messages</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(settings.templates) as Array<keyof PlatformSettings['templates']>).map(
          (key) => (
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
              value={settings.templates[key]}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  templates: { ...settings.templates, [key]: event.target.value },
                })
              }
            />
          ),
        )}
      </div>
      <Button
        variant="blue"
        loading={saveTemplates.isPending}
        onClick={() => saveTemplates.mutate(settings.templates)}
      >
        Enregistrer les modèles
      </Button>
    </Card>
  );
}
