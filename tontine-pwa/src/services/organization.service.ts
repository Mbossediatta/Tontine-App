import type {
  FundView,
  MyOrgDues,
  OrgReceipt,
  RecordPaymentInput,
  SaveFundInput,
  StructureFunds,
  StructureMoneySummary,
  OrgPaymentsPage,
  AddMemberInput,
  OrgDashboard,
  OrgFundRow,
  OrgPaymentsQuery,
  StructureFundsInput,
  MemberLocation,
  MyOrganization,
  OrgBranding,
  OrgMemberStatus,
  OrgMembersPage,
  OrgMembersQuery,
  OrgRole,
  OrganizationManageView,
  OrganizationSummary,
  SaveOrganizationInput,
  SaveStructureInput,
  StructureJoinPreview,
  StructureRole,
  StructureStatus,
  StructureView,
} from '@/types';

/**
 * Organisations institutionnelles (ex. AFP) : espace fermé, à part des tontines.
 * Le serveur vérifie tous les droits ; le super admin ne lit jamais le fichier des militants.
 */
export interface OrganizationService {
  /** Habillage public (avant la connexion) d'après l'adresse : /o/afp. */
  branding(slug: string): Promise<OrgBranding | null>;
  /** Habillage public d'après un code d'invitation de structure (null : pas une structure). */
  inviteBranding(code: string): Promise<OrgBranding | null>;

  // Super administrateur
  list(): Promise<OrganizationSummary[]>;
  save(input: SaveOrganizationInput): Promise<string>;
  setRole(organizationId: string, phone: string, role: OrgRole, grant: boolean): Promise<void>;

  // Militant
  mine(): Promise<MyOrganization[]>;
  joinPreview(code: string): Promise<StructureJoinPreview | null>;
  join(code: string, location: MemberLocation): Promise<void>;

  // Administration (admin général, responsables de structure)
  manageView(slug: string): Promise<OrganizationManageView>;
  saveStructure(input: SaveStructureInput): Promise<string>;
  /** Création d’une structure avec sa cotisation et ses frais d’adhésion (une transaction). */
  createStructureWithFunds(input: SaveStructureInput, funds: StructureFundsInput): Promise<string>;
  setStructureStatus(structureId: string, status: StructureStatus): Promise<void>;
  setStructureRole(
    structureId: string,
    phone: string,
    role: StructureRole,
    grant: boolean,
  ): Promise<void>;
  regenerateInvite(structureId: string): Promise<string>;
  structureView(structureId: string): Promise<StructureView>;
  decide(structureMemberId: string, accept: boolean): Promise<void>;
  removeMember(structureMemberId: string, reason: string): Promise<void>;
  moveMember(structureMemberId: string, targetStructureId: string): Promise<void>;
  membersPage(query: OrgMembersQuery): Promise<OrgMembersPage>;
  updateMember(
    orgMemberId: string,
    location: Partial<MemberLocation>,
    status: OrgMemberStatus,
  ): Promise<void>;

  // Caisses (étape 2)
  structureFunds(structureId: string): Promise<StructureFunds>;
  saveFund(input: SaveFundInput): Promise<string>;
  closeFund(fundId: string, closed: boolean): Promise<void>;
  fundView(fundId: string, year: number): Promise<FundView>;
  recordPayment(input: RecordPaymentInput): Promise<string>;
  cancelPayment(paymentId: string, reason: string): Promise<void>;
  exempt(installmentId: string, reason: string): Promise<void>;
  receipt(paymentId: string): Promise<OrgReceipt>;
  myDues(slug: string): Promise<MyOrgDues>;
  /** Super admin : encaissé total par organisation (identifiant → FCFA). */
  collectedByOrganization(): Promise<Record<string, number>>;
  /** Administration : encaissé et reste à recouvrer par structure visible. */
  moneySummary(slug: string): Promise<StructureMoneySummary>;
  /** Tous les paiements visibles de l’organisation, filtrés, 50 par page. */
  paymentsPage(query: OrgPaymentsQuery): Promise<OrgPaymentsPage>;
  /** Inscription directe d’un militant (compte créé si le numéro est nouveau). */
  addMember(input: AddMemberInput): Promise<{ userId: string; memberNumber: string }>;
  dashboard(slug: string): Promise<OrgDashboard>;
  funds(slug: string): Promise<OrgFundRow[]>;
}
