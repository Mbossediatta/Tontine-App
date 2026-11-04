import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardTitle } from '@/components/ui';
import { settingsService } from '@/services';

/**
 * Ce que l'application protège déjà, avec les réglages en vigueur, et ce qui revient
 * au serveur une fois le backend branché.
 */
export function SecurityProtections() {
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => settingsService.get(),
  });
  const security = settings.data?.security;
  const protections = [
    `Code PIN bloqué après ${security?.maxPinAttempts ?? '…'} essais ratés ; seul un code SMS permet d’en créer un nouveau.`,
    `Application verrouillée après ${security?.inactivityLockMinutes ?? '…'} minutes sans activité.`,
    `Codes SMS à usage unique, valables ${security?.otpValidityMinutes ?? '…'} minutes.`,
    'Droits vérifiés à chaque action : un compte ne voit que ses groupes ; chaque refus est noté ici.',
    'Textes ressemblant à une injection (SQL ou script) refusés et signalés ici en « critique ».',
    'Sur ordinateur, aucun compte n’est retenu d’une ouverture à l’autre.',
  ];

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Protections en place</CardTitle>
      <ul className="flex flex-col gap-2">
        {protections.map((text) => (
          <li key={text} className="flex gap-2 text-label text-ink">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
      <p className="rounded-control bg-blue-100 p-3 text-label text-blue-900">
        <strong>Côté serveur (à la mise en production)</strong> : la vraie barrière contre les
        injections est le serveur (requêtes paramétrées, règles d’accès de la base, limite du nombre
        de requêtes). Il enregistrera aussi les tentatives qui ne passent pas par l’application ;
        elles s’afficheront dans ce journal.
      </p>
      <Link to="/admin/parametres" className="self-start text-label font-bold text-blue-700">
        Modifier les réglages de sécurité →
      </Link>
    </Card>
  );
}
