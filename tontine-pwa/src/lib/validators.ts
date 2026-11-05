import { z } from 'zod';
import { isWeakPin } from './checks';
import { maxDueDay } from './tontine';

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
    contributionAmount: requiredInt('Indiquez le montant de la cotisation').min(
      500,
      'Montant minimum : 500 FCFA',
    ),
    dailyContribution: z.boolean(),
    turnDurationDays: requiredInt('Indiquez la durée du tour').min(1).max(90),
    sharesPerRound: requiredInt('Indiquez le nombre de parts par tour').min(1).max(50),
    membershipFeeAmount: requiredInt('Indiquez le montant des frais').min(0),
    collectMembershipFee: z.boolean(),
    reserveFinalTurn: z.boolean(),
    frequency: z.enum(['weekly', 'biweekly', 'monthly'], { error: 'Choisissez une fréquence' }),
    maxMembers: requiredInt('Indiquez le nombre total de parts')
      .min(2, 'Au moins 2 parts')
      .max(50, 'Au plus 50 parts'),
    paymentDueDay: requiredInt('Indiquez le jour limite').min(1, 'Jour invalide'),
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
    if (value.collectMembershipFee && value.membershipFeeAmount < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['membershipFeeAmount'],
        message: 'Indiquez un montant supérieur à zéro.',
      });
    }
    if (value.reserveFinalTurn && value.turnDurationDays < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['turnDurationDays'],
        message: 'Indiquez une durée valide pour le dernier tour.',
      });
    }
    const max = maxDueDay(value.frequency);
    if (value.paymentDueDay > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentDueDay'],
        message:
          value.frequency === 'monthly'
            ? 'Choisissez un jour entre 1 et 28'
            : 'Choisissez un jour de la semaine',
      });
    }
  });
export type CreateGroupValues = z.infer<typeof createGroupSchema>;

/** Champs validés à chaque étape de l'assistant de création. */
export const CREATE_GROUP_STEPS = [
  ['name', 'description', 'adminId', 'communityId'],
  [
    'contributionAmount',
    'dailyContribution',
    'turnDurationDays',
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

export const groupSettingsSchema = z.object({
  name: groupNameSchema,
  description: groupDescriptionSchema,
  contributionAmount: requiredInt('Indiquez le montant').min(500, 'Montant minimum : 500 FCFA'),
  dailyContribution: z.boolean(),
  turnDurationDays: requiredInt('Indiquez la durée du tour').min(1).max(90),
  sharesPerRound: requiredInt('Indiquez les parts par tour').min(1).max(50),
  membershipFeeAmount: requiredInt('Indiquez les frais').min(0),
  collectMembershipFee: z.boolean(),
  reserveFinalTurn: z.boolean(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  maxMembers: requiredInt('Indiquez le nombre de parts').min(2, 'Au moins 2').max(50, 'Au plus 50'),
  startDate: z.string().min(1, 'Choisissez une date de démarrage'),
  latePenalty: z
    .number({ error: 'Montant invalide' })
    .int('Nombre entier attendu')
    .min(0, 'Montant invalide')
    .optional(),
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
