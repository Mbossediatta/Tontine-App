// Point d'entrée unique de la couche de données.
// Aujourd'hui toutes les implémentations sont simulées ; les versions Supabase
// implémenteront les mêmes interfaces et seront choisies ici selon VITE_USE_MOCKS.
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

// VITE_AUTH_MODE=supabase : connexion réelle (code SMS et PIN par le backend), données
// encore simulées en attendant les autres services.
export const authService: AuthService =
  import.meta.env.VITE_AUTH_MODE === 'supabase'
    ? createSupabaseAuthService(mockSessionBridge)
    : mockAuthService;
export const communicationService: CommunicationService = mockCommunicationService;
export const disputeService: DisputeService = mockDisputeService;
export const financeService: FinanceService = mockFinanceService;
export const groupService: GroupService = mockGroupService;
export const membershipService: MembershipService = mockMembershipService;
export const roundService: RoundService = mockRoundService;
export const paymentService: PaymentService = mockPaymentService;
export const reportService: ReportService = mockReportService;
export const settingsService: SettingsService = mockSettingsService;
export const notificationService: NotificationService = mockNotificationService;
export const adminService: AdminService = mockAdminService;
export const swapService: SwapService = mockSwapService;
export const memberService: MemberService = mockMemberService;

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
