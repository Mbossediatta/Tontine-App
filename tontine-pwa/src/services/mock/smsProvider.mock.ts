import { formatPhone } from '@/lib/format';
import type { SmsService } from '../sms.service';

/** SMS simulés : aucun envoi réel, le message est affiché dans la console du navigateur. */
export const mockSmsService: SmsService = {
  async send(phone, message) {
    console.info(`[SMS simulé] → ${formatPhone(phone)} : ${message}`);
  },
};
