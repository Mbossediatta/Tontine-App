// Choix du fournisseur de SMS : c'est la SEULE ligne à changer pour brancher un vrai
// fournisseur (une implémentation de SmsService qui appelle son API).
import { mockSmsService } from './mock/smsProvider.mock';
import type { SmsService } from './sms.service';

export const smsService: SmsService = mockSmsService;
