import {
  createGroupSchema,
  joinCodeSchema,
  otpSchema,
  phoneSchema,
  profileSchema,
  type CreateGroupValues,
} from './validators';

const validGroup: CreateGroupValues = {
  name: 'Tontine Famille',
  description: '',
  contributionAmount: 4500,
  turnLength: 10,
  sharesPerRound: 1,
  membershipFeeAmount: 0,
  collectMembershipFee: false,
  reserveFinalTurn: true,
  frequency: 'daily',
  maxMembers: 10,
  paymentDueDay: 10,
  startDate: '2026-12-01',
  attributionMode: 'random',
  joinPolicy: 'invite',
};

describe('phoneSchema', () => {
  it('accepte 9 chiffres commençant par 7', () => {
    for (const phone of ['771234567', '781234567', '761234567', '701234567']) {
      expect(phoneSchema.safeParse(phone).success).toBe(true);
    }
  });

  it('refuse les autres formats', () => {
    for (const phone of ['671234567', '77123456', '7712345678', '77 123 45 67', '']) {
      expect(phoneSchema.safeParse(phone).success).toBe(false);
    }
  });
});

describe('otpSchema', () => {
  it('exige exactement 6 chiffres', () => {
    expect(otpSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(otpSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(otpSchema.safeParse({ code: '12345a' }).success).toBe(false);
  });
});

describe('profileSchema', () => {
  it('exige prénom et nom', () => {
    expect(profileSchema.safeParse({ firstName: 'Awa', lastName: 'Fall' }).success).toBe(true);
    expect(profileSchema.safeParse({ firstName: 'A', lastName: 'Fall' }).success).toBe(false);
  });
});

describe('joinCodeSchema', () => {
  it('accepte un code alphanumérique', () => {
    expect(joinCodeSchema.safeParse({ code: 'FAM4K7' }).success).toBe(true);
    expect(joinCodeSchema.safeParse({ code: 'FA-4' }).success).toBe(false);
  });
});

describe('createGroupSchema', () => {
  it('accepte un groupe valide', () => {
    expect(createGroupSchema.safeParse(validGroup).success).toBe(true);
  });

  it('limite le nom entre 3 et 50 caractères', () => {
    expect(createGroupSchema.safeParse({ ...validGroup, name: 'Ab' }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...validGroup, name: 'x'.repeat(51) }).success).toBe(
      false,
    );
  });

  it('exige une cotisation entière et positive (bornes : Paramètres, vérifiées par le serveur)', () => {
    expect(createGroupSchema.safeParse({ ...validGroup, contributionAmount: 0 }).success).toBe(
      false,
    );
    expect(createGroupSchema.safeParse({ ...validGroup, contributionAmount: 1000.5 }).success).toBe(
      false,
    );
    expect(createGroupSchema.safeParse({ ...validGroup, contributionAmount: 100 }).success).toBe(
      true,
    );
  });

  it('limite le nombre total de parts entre 2 et 50', () => {
    expect(createGroupSchema.safeParse({ ...validGroup, maxMembers: 1 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...validGroup, maxMembers: 51 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...validGroup, maxMembers: 2 }).success).toBe(true);
  });

  it('adapte le jour limite au rythme', () => {
    const monthly = { ...validGroup, frequency: 'monthly' as const, turnLength: 1 };
    expect(createGroupSchema.safeParse({ ...monthly, paymentDueDay: 28 }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...monthly, paymentDueDay: 29 }).success).toBe(false);
    // Journalier : la date limite est le dernier jour du tour, le jour limite ne sert pas.
    expect(createGroupSchema.safeParse({ ...validGroup, paymentDueDay: 1 }).success).toBe(true);
    const weekly = { ...validGroup, frequency: 'weekly' as const };
    expect(createGroupSchema.safeParse({ ...weekly, paymentDueDay: 7 }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...weekly, paymentDueDay: 8 }).success).toBe(false);
  });

  it('limite la durée d’un tour selon le rythme', () => {
    expect(createGroupSchema.safeParse({ ...validGroup, turnLength: 365 }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...validGroup, turnLength: 366 }).success).toBe(false);
    const monthly = { ...validGroup, frequency: 'monthly' as const, paymentDueDay: 5 };
    expect(createGroupSchema.safeParse({ ...monthly, turnLength: 12 }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...monthly, turnLength: 25 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...validGroup, turnLength: 0 }).success).toBe(false);
  });

  it('refuse une pénalité négative', () => {
    expect(createGroupSchema.safeParse({ ...validGroup, latePenalty: -1 }).success).toBe(false);
    expect(createGroupSchema.safeParse({ ...validGroup, latePenalty: 500 }).success).toBe(true);
  });
});
