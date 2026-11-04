import { Hammer } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui';

/** Rubriques des phases 2 et 3 : titre, phase prévue et contenu attendu (cahier du super admin). */
const SECTIONS: Record<string, { title: string; phase: number; features: string[] }> = {
  '/admin/transactions': {
    title: 'Transactions',
    phase: 2,
    features: [
      'Historique de tous les paiements (en ligne et espèces) avec filtres : date, groupe, statut, méthode',
      'Détail d’une transaction et reçu associé',
      'Réconciliation : attendu, reçu du service de paiement, enregistré dans l’application',
      'Export en Excel ou PDF',
    ],
  },
  '/admin/versements': {
    title: 'Versements',
    phase: 2,
    features: [
      'Tous les versements aux bénéficiaires : prévus, validés, effectués',
      'Contrôle des versements validés par les admins, avec possibilité de bloquer un versement en cas de doute',
    ],
  },
  '/admin/litiges': {
    title: 'Litiges et remboursements',
    phase: 2,
    features: [
      'Réclamations des membres : paiement débité mais non enregistré, double paiement, erreur de montant',
      'Suivi de chaque litige (ouvert, en cours, résolu) et validation des remboursements',
    ],
  },
  '/admin/annonces': {
    title: 'Notifications et annonces',
    phase: 3,
    features: [
      'Annonce à toute la plateforme, à tous les admins ou à un groupe précis',
      'Modèles de messages automatiques : rappel avant échéance, relance, confirmation de paiement, avis de versement',
      'Suivi des SMS envoyés (codes de connexion, rappels) et de leur coût',
    ],
  },
  '/admin/rapports': {
    title: 'Rapports et statistiques',
    phase: 3,
    features: [
      'Bilans par période, par admin et par groupe',
      'Évolution des membres, recouvrement, retards, montants collectés et versés',
      'Export PDF et Excel',
    ],
  },
  '/admin/audit': {
    title: 'Journal d’audit',
    phase: 3,
    features: [
      'Historique non modifiable de toutes les actions importantes : qui, quoi, quand',
      'Filtres par utilisateur, type d’action et date',
      'Déjà enregistré dès aujourd’hui : créations de groupes, montants modifiés, versements validés, suspensions, connexions des admins (les 5 dernières sont sur le tableau de bord)',
    ],
  },
  '/admin/parametres': {
    title: 'Paramètres',
    phase: 3,
    features: [
      'Paiement : clés API, frais, mode test ou réel',
      'Règles des tontines : délai de grâce, pénalités, limites de montant et de membres',
      'Connexion et sécurité : validité du code SMS, essais avant blocage du PIN, verrouillage après inactivité',
      'Fournisseur SMS, et application : nom, logo, couleurs, pages légales',
    ],
  },
};

/**
 * Page d'attente d'une rubrique pas encore construite : dit ce qu'elle contiendra
 * et dans quelle phase, plutôt que d'afficher une page vide.
 */
export default function ComingSoonPage() {
  const { pathname } = useLocation();
  const section = SECTIONS[pathname];
  if (!section) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        title={section.title}
        plain
        subtitle={`En préparation · phase ${section.phase}`}
      />
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <Hammer className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="font-bold text-ink">Cette rubrique contiendra :</p>
        </div>
        <ul className="flex list-disc flex-col gap-2 pl-6 text-ink marker:text-green-600">
          {section.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
