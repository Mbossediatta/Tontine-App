import { z } from 'zod';
import { isWeakPin } from './checks';
import { MAX_TURN_LENGTH, formatPeriods, maxDueDay, unevenSharesMessage } from './tontine';
import type { Frequency } from '@/types';

// Vérifications simples déplacées dans lib/checks (sans Zod) ; reprises ici pour
// les formulaires et l'ancien chemin d'import.
export { isSenegalMobile, isWeakPin } from './checks';

export const PHONE_ERROR = 'Numéro invalide : 9 chiffres commençant par 7';

export const phoneSchema = z.string().regex(/^7\d{8}$/, PHONE_ERROR);

export const loginSchema = z.object({ phone: phoneSchema });
export type LoginValues = z.infer<typeof loginSchema>;

export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Saisissez les 6 chiffres du code'),
});
export type OtpValues = z.infer<typeof otpSchema>;

const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} : 2 caractères minimum`)
    .max(40, `${label} : 40 caractères maximum`);

export const profileSchema = z.object({
  firstName: personName('Prénom'),
  lastName: personName('Nom'),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const payoutSchema = z.object({
  payoutMethod: z.enum(['wave', 'orange_money'], { error: 'Choisissez un service' }),
  payoutPhone: phoneSchema,
});
export type PayoutValues = z.infer<typeof payoutSchema>;

export const joinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, 'Code trop court')
    .max(12, 'Code trop long')
    .regex(/^[A-Za-z0-9]+$/, 'Lettres et chiffres uniquement'),
});
export type JoinCodeValues = z.infer<typeof joinCodeSchema>;

const requiredInt = (message: string) => z.number({ error: message }).int('Nombre entier attendu');

export const groupNameSchema = z
  .string()
  .trim()
  .min(3, 'Le nom doit contenir au moins 3 caractères')
  .max(50, 'Le nom doit contenir au plus 50 caractères');

export const groupDescriptionSchema = z
  .string()
  .trim()
  .max(300, '300 caractères maximum')
  .optional();

export const createGroupSchema = z
  .object({
    name: groupNameSchema,
    description: groupDescriptionSchema,
    /** Photo ou logo, facultatif (image déjà compressée par GroupPhotoPicker). */
    photoUrl: z.string().optional(),
    // Minimum et maximum : réglés par le super admin (Paramètres → Règles), vérifiés par le serveur.
    contributionAmount: requiredInt('Indiquez le montant de la cotisation').min(
      1,
      'Indiquez un montant positif',
    ),
    turnLength: requiredInt('Indiquez la durée d’un tour').min(1, 'Au moins 1'),
    sharesPerRound: requiredInt('Indiquez le nombre de parts par tour').min(1).max(50),
    membershipFeeAmount: requiredInt('Indiquez le montant des frais').min(0),
    collectMembershipFee: z.boolean(),
    reserveFinalTurn: z.boolean(),
    frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly'], {
      error: 'Choisissez le rythme de cotisation',
    }),
    maxMembers: requiredInt('Indiquez le nombre total de parts')
      .min(2, 'Au moins 2 parts')
      .max(50, 'Au plus 50 parts'),
    paymentDueDay: requiredInt('Indiquez le jour limite').min(1, 'Jour invalide'),
    paymentDueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)'),
    startDate: z.string().min(1, 'Choisissez une date de démarrage'),
    latePenalty: z
      .number({ error: 'Montant invalide' })
      .int('Nombre entier attendu')
      .min(0, 'Montant invalide')
      .optional(),
    attributionMode: z.enum(['random', 'manual'], { error: 'Choisissez un mode' }),
    communityId: z.string().optional(),
    joinPolicy: z.enum(['invite', 'community']),
    /** Administrateur responsable : choisi par le super administrateur uniquement. */
    adminId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sharesPerRound > value.maxMembers) {
      ctx.addIssue({
        code: 'custom',
        path: ['sharesPerRound'],
        message: 'Le nombre de parts par tour ne peut pas dépasser les parts du groupe.',
      });
    }
    checkEvenShares(value, ctx);
    if (value.collectMembershipFee && value.membershipFeeAmount < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['membershipFeeAmount'],
        message: 'Indiquez un montant supérieur à zéro.',
      });
    }
    checkTurnLength(value, ctx);
  });
export type CreateGroupValues = z.infer<typeof createGroupSchema>;

/** Parts du groupe en lots complets de parts par tour (sinon dernier tour avantagé). */
function checkEvenShares(
  value: { maxMembers: number; sharesPerRound: number },
  ctx: z.RefinementCtx,
): void {
  const message = unevenSharesMessage(value.maxMembers, value.sharesPerRound);
  if (message) ctx.addIssue({ code: 'custom', path: ['maxMembers'], message });
}

/** Durée d'un tour dans la limite de son rythme (un an, deux ans en mensuel) et jour limite. */
function checkTurnLength(
  value: { frequency: Frequency; turnLength: number; paymentDueDay: number },
  ctx: z.RefinementCtx,
): void {
  const max = MAX_TURN_LENGTH[value.frequency];
  if (value.turnLength > max) {
    ctx.addIssue({
      code: 'custom',
      path: ['turnLength'],
      message: `Au plus ${formatPeriods(value.frequency, max)} par tour`,
    });
  }
  const maxDay = maxDueDay(value.frequency);
  if (maxDay > 0 && value.paymentDueDay > maxDay) {
    ctx.addIssue({
      code: 'custom',
      path: ['paymentDueDay'],
      message:
        value.frequency === 'monthly'
          ? 'Choisissez un jour entre 1 et 28'
          : 'Choisissez un jour de la semaine',
    });
  }
}

/** Champs validés à chaque étape de l'assistant de création. */
export const CREATE_GROUP_STEPS = [
  ['name', 'description', 'adminId', 'communityId'],
  [
    'contributionAmount',
    'frequency',
    'turnLength',
    'paymentDueDay',
    'paymentDueTime',
    'sharesPerRound',
    'membershipFeeAmount',
    'collectMembershipFee',
    'reserveFinalTurn',
    'maxMembers',
    'startDate',
    'latePenalty',
  ],
  ['attributionMode'],
  [],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof CreateGroupValues>>;

export const groupSettingsSchema = z
  .object({
    name: groupNameSchema,
    description: groupDescriptionSchema,
    contributionAmount: requiredInt('Indiquez le montant').min(1, 'Indiquez un montant positif'),
    turnLength: requiredInt('Indiquez la durée d’un tour').min(1, 'Au moins 1'),
    sharesPerRound: requiredInt('Indiquez les parts par tour').min(1).max(50),
    membershipFeeAmount: requiredInt('Indiquez les frais').min(0),
    collectMembershipFee: z.boolean(),
    reserveFinalTurn: z.boolean(),
    frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
    maxMembers: requiredInt('Indiquez le nombre de parts')
      .min(2, 'Au moins 2')
      .max(50, 'Au plus 50'),
    paymentDueDay: requiredInt('Indiquez le jour limite').min(1, 'Jour invalide'),
    paymentDueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)'),
    startDate: z.string().min(1, 'Choisissez une date de démarrage'),
    latePenalty: z
      .number({ error: 'Montant invalide' })
      .int('Nombre entier attendu')
      .min(0, 'Montant invalide')
      .optional(),
  })
  .superRefine((value, ctx) => {
    checkEvenShares(value, ctx);
    checkTurnLength(value, ctx);
  });
export type GroupSettingsValues = z.infer<typeof groupSettingsSchema>;

export const addByPhoneSchema = z.object({
  phone: phoneSchema,
  shareCount: z
    .number({ error: 'Indiquez le nombre de parts' })
    .int('Le nombre de parts doit être entier')
    .min(1, 'Au moins une part')
    .max(50, 'Au plus 50 parts'),
});
export type AddByPhoneValues = z.infer<typeof addByPhoneSchema>;

export const pinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, 'Saisissez les 4 chiffres du PIN')
    .refine((pin) => !isWeakPin(pin), 'Ce PIN est trop facile à deviner. Choisissez-en un autre.'),
});

/** Création ou modification d'un administrateur par le super administrateur. */
export const adminSchema = profileSchema.extend({ phone: phoneSchema });
export type AdminValues = z.infer<typeof adminSchema>;

/** Changement de numéro d'un membre : nouveau numéro + code SMS reçu sur ce numéro. */
export const changePhoneSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Saisissez les 6 chiffres du code'),
});
export type ChangePhoneValues = z.infer<typeof changePhoneSchema>;
