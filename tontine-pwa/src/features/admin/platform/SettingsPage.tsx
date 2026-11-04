import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { settingsService } from '@/services';
import type { PlatformSettings } from '@/types';
import { PageFrame, QueryState } from './PlatformUi';
import { PaymentSection, RulesSection, SecuritySection } from './SettingsPaymentSections';
import { AppSection, SmsSection, TemplatesSection } from './SettingsMessagingSections';

export function SettingsPage() {
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => settingsService.get() });
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (query.data) setSettings(query.data);
  }, [query.data]);
  if (!settings) {
    return (
      <PageFrame title="Paramètres" subtitle="Configuration et règles de la plateforme.">
        <QueryState query={query}>{null}</QueryState>
      </PageFrame>
    );
  }
  const props = { settings, setSettings };
  return (
    <PageFrame title="Paramètres" subtitle="Configuration et règles de la plateforme.">
      <div className="flex items-start gap-3 rounded-control bg-blue-100 p-4 text-blue-900">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-label">
          Les clés sont masquées dans les champs. En production, elles doivent être conservées côté
          serveur et ne jamais être exposées au navigateur.
        </p>
      </div>
      <PaymentSection {...props} />
      <RulesSection {...props} />
      <SecuritySection {...props} />
      <SmsSection {...props} />
      <AppSection {...props} />
      <TemplatesSection {...props} />
    </PageFrame>
  );
}
