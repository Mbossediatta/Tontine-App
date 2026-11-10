// Organisations institutionnelles (ex. AFP) : structures, militants, rôles.
// Données servies par les fonctions SQL de la migration …_organisations.sql.

export type OrgRole = 'org_admin' | 'finance_admin' | 'controller';
export type StructureType =
  | 'national'
  | 'mouvement'
  | 'commission_permanente'
  | 'commission_ad_hoc'
  | 'departement'
  | 'commune'
  | 'diaspora'
  | 'autre';
export type StructureStatus = 'active' | 'suspended' | 'archived';
export type StructureRole = 'responsable' | 'tresorier' | 'secretaire' | 'gestionnaire_membres';
export type OrgMemberStatus = 'pending' | 'active' | 'suspended' | 'left';
export type StructureMemberStatus = 'pending' | 'active' | 'left' | 'rejected';

/** Habillage d'une organisation (lisible avant la connexion). */
export interface OrgBranding {
  name: string;
  shortName: string;
  slug: string;
  color: string;
  logoUrl?: string | null;
  /** Rempli quand l'habillage vient d'un code d'invitation de structure. */
  structureName?: string;
}

export interface Organization extends OrgBranding {
  id: string;
  isSuspended: boolean;
}

export interface PersonRole<R> {
  userId: string;
  role: R;
  firstName: string;
  lastName: string;
  phone: string;
}

/** Ligne de la rubrique « Organisations » du super admin : chiffres globaux seulement. */
export interface OrganizationSummary extends Organization {
  createdAt: string;
  memberCount: number;
  pendingCount: number;
  structureCount: number;
  admins: PersonRole<OrgRole>[];
}

export interface SaveOrganizationInput {
  id?: string;
  name: string;
  shortName: string;
  slug: string;
  color: string;
  logoUrl?: string;
  isSuspended?: boolean;
}

export interface Structure {
  id: string;
  organizationId: string;
  parentId?: string | null;
  parentName?: string | null;
  name: string;
  type: StructureType;
  description?: string | null;
  contactPhone?: string | null;
  logoUrl?: string | null;
  status: StructureStatus;
  inviteCode: string;
  createdAt: string;
  memberCount: number;
  pendingCount: number;
  roles: PersonRole<StructureRole>[];
}

export interface SaveStructureInput {
  organizationId: string;
  id?: string;
  name: string;
  type: StructureType;
  parentId?: string | null;
  description?: string;
  contactPhone?: string;
  logoUrl?: string;
}

/** Ce que le compte connecté a dans une organisation (accueil, Espace AFP). */
export interface MyOrganization extends Organization {
  memberNumber?: string | null;
  memberStatus?: OrgMemberStatus | null;
  joinedAt?: string | null;
  region?: string | null;
  departement?: string | null;
  commune?: string | null;
  localite?: string | null;
  orgRoles: OrgRole[];
  structures: {
    membershipId: string;
    structureId: string;
    name: string;
    type: StructureType;
    status: StructureMemberStatus;
    structureStatus: StructureStatus;
    since: string;
  }[];
  managedStructures: { structureId: string; name: string; role: StructureRole }[];
}

export interface OrganizationManageView {
  organization: Organization;
  isOrgAdmin: boolean;
  /** Super admin : consultation seule. */
  readOnly?: boolean;
  myOrgRoles: OrgRole[];
  structures: Structure[];
  stats: { activeMembers: number; pendingRequests: number; activeStructures: number };
  orgRoles: PersonRole<OrgRole>[];
}

export interface StructureMemberRow {
  id: string;
  userId: string;
  status: StructureMemberStatus;
  requestedAt: string;
  decidedAt?: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string | null;
  memberNumber?: string | null;
  region?: string | null;
  departement?: string | null;
  commune?: string | null;
  localite?: string | null;
}

export interface StructureView {
  organization: Organization;
  isOrgAdmin: boolean;
  /** Peut valider les adhésions, retirer des membres, changer le lien (faux en lecture seule). */
  canManage: boolean;
  structure: Structure;
  children: { id: string; name: string; status: StructureStatus }[];
  members: StructureMemberRow[];
}

export interface OrgMemberRow {
  id: string;
  userId: string;
  memberNumber?: string | null;
  status: OrgMemberStatus;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string | null;
  region?: string | null;
  departement?: string | null;
  commune?: string | null;
  localite?: string | null;
  joinedAt?: string | null;
  structures: {
    membershipId: string;
    structureId: string;
    name: string;
    status: StructureMemberStatus;
  }[];
}

export interface OrgMembersQuery {
  organizationId: string;
  query?: string;
  structureId?: string;
  departement?: string;
  status?: OrgMemberStatus;
  offset?: number;
}

export interface OrgMembersPage {
  rows: OrgMemberRow[];
  total: number;
  pageSize: number;
}

export interface MemberLocation {
  region: string;
  departement: string;
  commune?: string;
  localite?: string;
}

export interface StructureJoinPreview {
  organization: Organization;
  structure: {
    id: string;
    name: string;
    type: StructureType;
    description?: string | null;
    logoUrl?: string | null;
    status: StructureStatus;
    parentName?: string | null;
  };
  open: boolean;
  myStatus?: StructureMemberStatus | null;
  myFile?: (Partial<MemberLocation> & { memberNumber?: string | null }) | null;
}

// ---------------------------------------------------------------------------
// Caisses de cotisation (étape 2)
// ---------------------------------------------------------------------------

export type OrgFundKind = 'adhesion' | 'cotisation' | 'exceptionnelle' | 'volontaire';
export type OrgFundFrequency = 'once' | 'monthly' | 'quarterly' | 'yearly';
export type OrgPaymentMethod = 'cash' | 'wave' | 'orange_money' | 'virement' | 'autre';
/** upcoming : pas encore exigible ; late : non payée après la date due. */
export type OrgInstallmentStatus = 'paid' | 'partial' | 'upcoming' | 'late' | 'exempted';

export interface OrgFund {
  id: string;
  structureId: string;
  name: string;
  kind: OrgFundKind;
  amount: number;
  frequency: OrgFundFrequency;
  startDate: string;
  dueDay: number;
  endDate?: string | null;
  isClosed: boolean;
  createdAt: string;
  expected: number;
  collected: number;
  remaining: number;
  lateMembers: number;
}

export interface SaveFundInput {
  structureId: string;
  id?: string;
  name: string;
  kind: OrgFundKind;
  amount: number;
  frequency: OrgFundFrequency;
  startDate: string;
  dueDay: number;
  endDate?: string | null;
}

export interface OrgInstallment {
  id: string;
  fundId: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: OrgInstallmentStatus;
  paidAt?: string | null;
  paidLate: boolean;
  exemptionReason?: string | null;
}

export interface StructureFunds {
  canHandleMoney: boolean;
  funds: OrgFund[];
}

export interface FundMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  memberNumber?: string | null;
  active: boolean;
  remaining: number;
  lateCount: number;
  totalPaid: number;
  lastPaymentAt?: string | null;
  installments: OrgInstallment[];
}

export interface FundPaymentRow {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  amount: number;
  method: OrgPaymentMethod;
  reference?: string | null;
  receiptNumber: string;
  createdAt: string;
  recordedBy?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

export interface FundView {
  organization: Organization;
  structure: { id: string; name: string };
  fund: OrgFund;
  canHandleMoney: boolean;
  canCancel: boolean;
  year: number;
  members: FundMemberRow[];
  payments: FundPaymentRow[];
}

export interface RecordPaymentInput {
  fundId: string;
  userId: string;
  amount: number;
  method: OrgPaymentMethod;
  reference?: string;
}

export interface MyOrgDues {
  funds: {
    id: string;
    name: string;
    kind: OrgFundKind;
    amount: number;
    frequency: OrgFundFrequency;
    dueDay: number;
    isClosed: boolean;
    structureId: string;
    structureName: string;
    installments: OrgInstallment[];
  }[];
  payments: {
    id: string;
    fundId: string;
    fundName: string;
    fundKind: OrgFundKind;
    structureName: string;
    amount: number;
    method: OrgPaymentMethod;
    reference?: string | null;
    receiptNumber: string;
    createdAt: string;
    cancelledAt?: string | null;
  }[];
}

export interface OrgReceipt {
  organization: Organization;
  receiptNumber: string;
  memberName: string;
  memberNumber?: string | null;
  amount: number;
  fundName: string;
  fundKind: OrgFundKind;
  structureName: string;
  createdAt: string;
  method: OrgPaymentMethod;
  reference?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  recordedBy?: string | null;
  periods: { dueDate: string; amount: number }[];
}

export type StructureMoneySummary = Record<string, { collected: number; remaining: number }>;

/** Cotisations fixées à la création d'une structure (0 : aucune). */
export interface StructureFundsInput {
  contribution: number;
  frequency: OrgFundFrequency;
  dueDay: number;
  startDate: string;
  membershipFee: number;
}

export interface OrgPaymentRow {
  id: string;
  createdAt: string;
  amount: number;
  method: OrgPaymentMethod;
  reference?: string | null;
  receiptNumber: string;
  fundId: string;
  fundName: string;
  fundKind: OrgFundKind;
  structureId: string;
  structureName: string;
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  memberNumber?: string | null;
  recordedBy?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

export interface OrgPaymentsQuery {
  slug: string;
  structureId?: string;
  method?: OrgPaymentMethod;
  from?: string;
  to?: string;
  query?: string;
  offset?: number;
}

export interface OrgPaymentsPage {
  rows: OrgPaymentRow[];
  pageSize: number;
  summary: {
    count: number;
    amount: number;
    cancelledCount: number;
    byMethod: Partial<Record<OrgPaymentMethod, number>>;
  };
}

/** Ajout direct d'un militant par l'administration (nouveau numéro : prénom et nom requis). */
export interface AddMemberInput extends MemberLocation {
  structureId: string;
  phone: string;
  firstName?: string;
  lastName?: string;
}

export interface OrgDashboard {
  monthly: { month: string; amount: number }[];
  lateStructures: { id: string; name: string; remaining: number; lateMembers: number }[];
  pending: {
    id: string;
    structureId: string;
    structureName: string;
    firstName: string;
    lastName: string;
    requestedAt: string;
  }[];
  recentPayments: {
    id: string;
    amount: number;
    createdAt: string;
    firstName: string;
    lastName: string;
    structureName: string;
    fundName: string;
  }[];
}

export type OrgFundRow = OrgFund & { structureName: string };
