// Organisations (ex. AFP) : toutes les lectures et écritures passent par les fonctions SQL
// de la migration …_organisations.sql, qui vérifient les droits.
import { supabase } from '@/lib/supabase';
import type { OrgBranding } from '@/types';
import type { OrganizationService } from '../organization.service';
import { invoke, requireOnline, rpc, toServiceError } from './rpc';

/** Lecture publique (clé anon) : l'habillage, ou null s'il n'y a rien à habiller. */
async function publicBranding(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase().rpc(name, args);
  if (error) throw toServiceError(error, 'Chargement impossible.');
  return (data ?? null) as OrgBranding | null;
}

export function createSupabaseOrganizationService(): OrganizationService {
  return {
    branding: (slug) => publicBranding('organization_branding', { p_slug: slug }),
    inviteBranding: (code) => publicBranding('invite_branding', { p_code: code }),

    list: () => rpc('organizations_list'),
    async save(input) {
      requireOnline();
      return rpc<string>('organization_save', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_short_name: input.shortName,
        p_slug: input.slug,
        p_color: input.color,
        p_logo: input.logoUrl ?? null,
        p_is_suspended: input.isSuspended ?? false,
      });
    },
    async setRole(organizationId, phone, role, grant) {
      requireOnline();
      await rpc('organization_set_role', {
        p_org: organizationId,
        p_phone: phone,
        p_role: role,
        p_grant: grant,
      });
    },

    mine: () => rpc('my_organizations'),
    joinPreview: (code) => rpc('structure_join_preview', { p_code: code }),
    async join(code, location) {
      requireOnline();
      await rpc('structure_join', {
        p_code: code,
        p_region: location.region,
        p_departement: location.departement,
        p_commune: location.commune ?? null,
        p_localite: location.localite ?? null,
      });
    },

    manageView: (slug) => rpc('organization_manage_view', { p_slug: slug }),
    async saveStructure(input) {
      requireOnline();
      return rpc<string>('structure_save', {
        p_org: input.organizationId,
        p_id: input.id ?? null,
        p_name: input.name,
        p_type: input.type,
        p_parent: input.parentId ?? null,
        p_description: input.description ?? null,
        p_contact_phone: input.contactPhone ?? null,
        p_logo: input.logoUrl ?? null,
      });
    },
    async createStructureWithFunds(input, funds) {
      requireOnline();
      return rpc<string>('structure_create_with_funds', {
        p_org: input.organizationId,
        p_name: input.name,
        p_type: input.type,
        p_parent: input.parentId ?? null,
        p_description: input.description ?? null,
        p_contact_phone: input.contactPhone ?? null,
        p_logo: input.logoUrl ?? null,
        p_contribution: funds.contribution,
        p_frequency: funds.frequency,
        p_due_day: funds.dueDay,
        p_start_date: funds.startDate,
        p_membership_fee: funds.membershipFee,
      });
    },
    async setStructureStatus(structureId, status) {
      requireOnline();
      await rpc('structure_set_status', { p_id: structureId, p_status: status });
    },
    async setStructureRole(structureId, phone, role, grant) {
      requireOnline();
      await rpc('structure_set_role', {
        p_structure: structureId,
        p_phone: phone,
        p_role: role,
        p_grant: grant,
      });
    },
    async regenerateInvite(structureId) {
      requireOnline();
      return rpc<string>('structure_regenerate_invite', { p_id: structureId });
    },
    structureView: (structureId) => rpc('structure_view', { p_id: structureId }),
    async decide(id, accept) {
      requireOnline();
      await rpc('structure_member_decide', { p_id: id, p_accept: accept });
    },
    async removeMember(id, reason) {
      requireOnline();
      await rpc('structure_member_remove', { p_id: id, p_reason: reason });
    },
    async moveMember(id, target) {
      requireOnline();
      await rpc('structure_member_move', { p_id: id, p_target: target });
    },
    membersPage: (query) =>
      rpc('organization_members_page', {
        p_org: query.organizationId,
        p_query: query.query ?? null,
        p_structure: query.structureId ?? null,
        p_departement: query.departement ?? null,
        p_status: query.status ?? null,
        p_offset: query.offset ?? 0,
      }),
    async updateMember(id, location, status) {
      requireOnline();
      await rpc('organization_member_update', {
        p_id: id,
        p_region: location.region ?? null,
        p_departement: location.departement ?? null,
        p_commune: location.commune ?? null,
        p_localite: location.localite ?? null,
        p_status: status,
      });
    },

    structureFunds: (structureId) => rpc('structure_funds', { p_structure: structureId }),
    async saveFund(input) {
      requireOnline();
      return rpc<string>('org_fund_save', {
        p_structure: input.structureId,
        p_id: input.id ?? null,
        p_name: input.name,
        p_kind: input.kind,
        p_amount: input.amount,
        p_frequency: input.frequency,
        p_start_date: input.startDate,
        p_due_day: input.dueDay,
        p_end_date: input.endDate || null,
      });
    },
    async closeFund(fundId, closed) {
      requireOnline();
      await rpc('org_fund_close', { p_fund: fundId, p_closed: closed });
    },
    fundView: (fundId, year) => rpc('org_fund_view', { p_fund: fundId, p_year: year }),
    async recordPayment(input) {
      requireOnline();
      return rpc<string>('org_payment_record', {
        p_fund: input.fundId,
        p_user: input.userId,
        p_amount: input.amount,
        p_method: input.method,
        p_reference: input.reference ?? null,
      });
    },
    async cancelPayment(paymentId, reason) {
      requireOnline();
      await rpc('org_payment_cancel', { p_payment: paymentId, p_reason: reason });
    },
    async exempt(installmentId, reason) {
      requireOnline();
      await rpc('org_installment_exempt', { p_installment: installmentId, p_reason: reason });
    },
    receipt: (paymentId) => rpc('org_receipt', { p_payment: paymentId }),
    myDues: (slug) => rpc('my_org_dues', { p_slug: slug }),
    collectedByOrganization: () => rpc('organizations_collected'),
    moneySummary: (slug) => rpc('organization_money_summary', { p_slug: slug }),
    async addMember(input) {
      return invoke<{ userId: string; memberNumber: string }>('org-member-add', { ...input });
    },
    dashboard: (slug) => rpc('organization_dashboard', { p_slug: slug }),
    funds: (slug) => rpc('organization_funds', { p_slug: slug }),
    paymentsPage: (query) =>
      rpc('organization_payments_page', {
        p_slug: query.slug,
        p_structure: query.structureId ?? null,
        p_method: query.method ?? null,
        p_from: query.from || null,
        p_to: query.to || null,
        p_query: query.query || null,
        p_offset: query.offset ?? 0,
      }),
  };
}
