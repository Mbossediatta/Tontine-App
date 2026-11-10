-- Rôles et actions ajoutés pour la gestion financière (cahier § 14) : ces valeurs doivent
-- exister avant les migrations suivantes, qui s'en servent dans leurs fonctions.
--
-- - validator : autorité centrale de validation (approuve ou rejette les dépenses, décide
--   des financements) ;
-- - projects_manager : responsable des projets (suivi des demandes et des réalisations).

alter type public.org_role add value if not exists 'validator';
alter type public.org_role add value if not exists 'projects_manager';

alter type public.audit_action add value if not exists 'org_rule_added';
alter type public.audit_action add value if not exists 'org_common_entry';
alter type public.audit_action add value if not exists 'org_entry_cancelled';
alter type public.audit_action add value if not exists 'org_settings_updated';
alter type public.audit_action add value if not exists 'org_expense_submitted';
alter type public.audit_action add value if not exists 'org_expense_decided';
alter type public.audit_action add value if not exists 'org_expense_paid';
alter type public.audit_action add value if not exists 'org_financing_submitted';
alter type public.audit_action add value if not exists 'org_financing_decided';
alter type public.audit_action add value if not exists 'org_financing_paid';
alter type public.audit_action add value if not exists 'org_project_saved';
alter type public.audit_action add value if not exists 'org_document_added';
