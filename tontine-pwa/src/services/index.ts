// Point d'entrée unique de la couche de données.
import { env } from '@/lib/env';
import type { AdminService } from './admin.service';
import type { AuthService } from './auth.service';
import type { CommunicationService } from './communication.service';
import type { DisputeService } from './dispute.service';
import type { FinanceService } from './finance.service';
import type { GroupService } from './group.service';
import type { MemberService } from './member.service';
import type { MembershipService } from './membership.service';
import type { NotificationService } from './notification.service';
import type { PaymentService } from './payment.service';
import type { ReportService } from './report.service';
import type { RoundService } from './round.service';
import type { SettingsService } from './settings.service';
import type { SwapService } from './swap.service';
import { mockAdminService } from './mock/admin.mock';
import { mockAuthService, mockSessionBridge } from './mock/auth.mock';
import { mockCommunicationService } from './mock/communication.mock';
import { mockDisputeService } from './mock/dispute.mock';
import { mockFinanceService } from './mock/finance.mock';
import { mockGroupService } from './mock/group.mock';
import { mockMemberService } from './mock/member.mock';
import { mockMembershipService } from './mock/membership.mock';
import { mockNotificationService } from './mock/notification.mock';
import { mockPaymentService } from './mock/payment.mock';
import { mockReportService } from './mock/report.mock';
import { mockRoundService } from './mock/round.mock';
import { mockSettingsService } from './mock/settings.mock';
import { mockSwapService } from './mock/swap.mock';
import { createSupabaseAuthService } from './supabase/auth.supabase';
import { createSupabaseAdminService } from './supabase/admin.supabase';
import { completeSimulatedCheckout, getSimulatedCheckout } from './mock/gateway';
import {
  createSupabasePaymentService,
  createSupabaseRoundService,
  createSupabaseSwapService,
  supabaseSimulatedCheckout,
} from './supabase/cycle.supabase';
import {
  createSupabaseGroupService,
  createSupabaseMembershipService,
} from './supabase/group.supabase';
import {
  createSupabaseCommunicationService,
  createSupabaseDisputeService,
  createSupabaseFinanceService,
} from './supabase/finance.supabase';
import { createSupabaseMemberService } from './supabase/member.supabase';
import {
  createSupabaseNotificationService,
  createSupabaseReportService,
  createSupabaseSettingsService,
} from './supabase/platform.supabase';

// VITE_AUTH_MODE=supabase : tous les services passent par Supabase (base, fonctions SQL et
// Edge Functions). Sinon : la simulation locale (démonstration et tests unitaires).
export const authService: AuthService =
  import.meta.env.VITE_AUTH_MODE === 'supabase'
    ? createSupabaseAuthService(mockSessionBridge)
    : mockAuthService;
export const communicationService: CommunicationService = env.realAuth
  ? createSupabaseCommunicationService()
  : mockCommunicationService;
export const disputeService: DisputeService = env.realAuth
  ? createSupabaseDisputeService()
  : mockDisputeService;
export const financeService: FinanceService = env.realAuth
  ? createSupabaseFinanceService()
  : mockFinanceService;
export const groupService: GroupService = env.realAuth
  ? createSupabaseGroupService()
  : mockGroupService;
export const membershipService: MembershipService = env.realAuth
  ? createSupabaseMembershipService()
  : mockMembershipService;
export const roundService: RoundService = env.realAuth
  ? createSupabaseRoundService()
  : mockRoundService;
export const paymentService: PaymentService = env.realAuth
  ? createSupabasePaymentService()
  : mockPaymentService;
export const reportService: ReportService = env.realAuth
  ? createSupabaseReportService()
  : mockReportService;
export const settingsService: SettingsService = env.realAuth
  ? createSupabaseSettingsService()
  : mockSettingsService;
export const notificationService: NotificationService = env.realAuth
  ? createSupabaseNotificationService()
  : mockNotificationService;
export const adminService: AdminService = env.realAuth
  ? createSupabaseAdminService()
  : mockAdminService;
export const swapService: SwapService = env.realAuth
  ? createSupabaseSwapService()
  : mockSwapService;
/** Page de paiement simulée : simulation locale, ou serveur sans clés PayTech (local). */
export const simulatedCheckout = env.realAuth
  ? supabaseSimulatedCheckout
  : { get: getSimulatedCheckout, complete: completeSimulatedCheckout };
export const memberService: MemberService = env.realAuth
  ? createSupabaseMemberService()
  : mockMemberService;

export type {
  AdminService,
  AuthService,
  CommunicationService,
  DisputeService,
  FinanceService,
  GroupService,
  MemberService,
  MembershipService,
  NotificationService,
  PaymentService,
  ReportService,
  RoundService,
  SettingsService,
  SwapService,
};
