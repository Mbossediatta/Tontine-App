import { Button, Card, CardTitle, Input, Select } from '@/components/ui';
import type { PlatformSettings } from '@/types';
import { numberUpdater, useSaveSettings, type SectionProps } from './settingsState';

export function PaymentSection({ settings, setSettings }: SectionProps) {
  const savePayment = useSaveSettings('payment');
  const updateNumber = numberUpdater(setSettings);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Paiement</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Fournisseur"
          value={settings.payment.provider}
          onChange={(event) =>
            setSettings({
              ...settings,
              payment: { ...settings.payment, provider: event.target.value },
            })
          }
        />
        <Select
          label="Mode"
          value={settings.payment.mode}
          onChange={(event) =>
            setSettings({
              ...settings,
              payment: {
                ...settings.payment,
                mode: event.target.value as PlatformSettings['payment']['mode'],
              },
            })
          }
          options={[
            { value: 'test', label: 'Test' },
            { value: 'live', label: 'Production' },
          ]}
        />
        <Input
          label="Clé publique"
          type="password"
          autoComplete="new-password"
          value={settings.payment.publicKey}
          onChange={(event) =>
            setSettings({
              ...settings,
              payment: { ...settings.payment, publicKey: event.target.value },
            })
          }
        />
        <Input
          label="Clé secrète"
          type="password"
          autoComplete="new-password"
          value={settings.payment.secretKey}
          onChange={(event) =>
            setSettings({
              ...settings,
              payment: { ...settings.payment, secretKey: event.target.value },
            })
          }
        />
        <Input
          label="Frais (%)"
          type="number"
          min="0"
          step="0.1"
          value={settings.payment.feePercent}
          onChange={(event) => updateNumber('payment', 'feePercent', event.target.value)}
        />
      </div>
      <Button
        variant="blue"
        loading={savePayment.isPending}
        onClick={() => savePayment.mutate(settings.payment)}
      >
        Enregistrer le paiement
      </Button>
    </Card>
  );
}

export function RulesSection({ settings, setSettings }: SectionProps) {
  const saveRules = useSaveSettings('rules');
  const updateNumber = numberUpdater(setSettings);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Règles des tontines</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="Délai de grâce (jours)"
          type="number"
          min="0"
          value={settings.rules.graceDays}
          onChange={(event) => updateNumber('rules', 'graceDays', event.target.value)}
        />
        <Input
          label="Pénalité par défaut (FCFA)"
          type="number"
          min="0"
          value={settings.rules.defaultLatePenalty}
          onChange={(event) => updateNumber('rules', 'defaultLatePenalty', event.target.value)}
        />
        <Input
          label="Cotisation minimale (FCFA)"
          type="number"
          min="1"
          value={settings.rules.minContribution}
          onChange={(event) => updateNumber('rules', 'minContribution', event.target.value)}
        />
        <Input
          label="Cotisation maximale (FCFA)"
          type="number"
          min="1"
          value={settings.rules.maxContribution}
          onChange={(event) => updateNumber('rules', 'maxContribution', event.target.value)}
        />
        <Input
          label="Nombre maximal de parts par groupe"
          type="number"
          min="2"
          value={settings.rules.maxMembers}
          onChange={(event) => updateNumber('rules', 'maxMembers', event.target.value)}
        />
      </div>
      <Button
        variant="blue"
        loading={saveRules.isPending}
        onClick={() => saveRules.mutate(settings.rules)}
      >
        Enregistrer les règles
      </Button>
    </Card>
  );
}

export function SecuritySection({ settings, setSettings }: SectionProps) {
  const saveSecurity = useSaveSettings('security');
  const updateNumber = numberUpdater(setSettings);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Connexion et sécurité</CardTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Validité du code SMS (minutes)"
          type="number"
          min="1"
          value={settings.security.otpValidityMinutes}
          onChange={(event) => updateNumber('security', 'otpValidityMinutes', event.target.value)}
        />
        <Input
          label="Essais PIN autorisés"
          type="number"
          min="1"
          value={settings.security.maxPinAttempts}
          onChange={(event) => updateNumber('security', 'maxPinAttempts', event.target.value)}
        />
        <Input
          label="Verrouillage après inactivité (minutes)"
          type="number"
          min="1"
          value={settings.security.inactivityLockMinutes}
          onChange={(event) =>
            updateNumber('security', 'inactivityLockMinutes', event.target.value)
          }
        />
      </div>
      <Button
        variant="blue"
        loading={saveSecurity.isPending}
        onClick={() => saveSecurity.mutate(settings.security)}
      >
        Enregistrer la sécurité
      </Button>
    </Card>
  );
}
