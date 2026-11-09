import type { Config } from 'tailwindcss';

/**
 * Charte « Calebasse de l’Espoir » (DESIGN-UI.md, sections 2 à 5).
 * Vert, bleu et blanc uniquement ; orange et rouge réservés aux statuts et erreurs.
 * La palette par défaut de Tailwind est remplacée : aucune autre couleur n'est disponible.
 */
const colors = {
  transparent: 'transparent',
  current: 'currentColor',
  white: '#FFFFFF',
  // Vert = succès, argent, validé. Les nuances existantes sont conservées, les autres complétées.
  green: {
    50: '#F1FBF5',
    100: '#E8F8EF',
    200: '#CDEFDA',
    300: '#A8E6C1',
    400: '#6FCB94',
    500: '#40B06D',
    600: '#2E9E5B',
    700: '#1F7A47',
    800: '#175E37',
    900: '#0F4024',
  },
  // Bleu = actions et navigation.
  blue: {
    50: '#F4F8FB',
    100: '#E3EEFA',
    200: '#C6DBF3',
    300: '#9BBFE9',
    400: '#6A9DDC',
    500: '#3B7BD0',
    600: '#2A69BE',
    700: '#1E5AA8',
    800: '#184C8F',
    900: '#12407A',
  },
  // Gris légèrement teintés de bleu (jamais de gris neutre pur).
  slate: {
    50: '#F7F9FB',
    100: '#EEF2F6',
    200: '#E1E7EE',
    300: '#C9D2DC',
    400: '#9AA7B5',
    500: '#6C7A8A',
    600: '#526070',
    700: '#3C4857',
    800: '#27323F',
    900: '#17212C',
  },
  // Ambre = « en retard » (et seulement ça).
  amber: {
    50: '#FFF8EC',
    100: '#FDEDD0',
    200: '#F9D9A0',
    300: '#F2BD62',
    400: '#E59F34',
    500: '#CC841C',
    600: '#A96910',
    700: '#86500C',
    800: '#653C0B',
    900: '#462A08',
  },
  ink: '#1B2733',
  muted: '#5B6B7A',
  line: '#DCE5EE',
  warning: { DEFAULT: '#B86E0F', bg: '#FDF3E3' },
  danger: { DEFAULT: '#C53A3A', bg: '#FBEBEB' },
  /**
   * Charte du parcours de connexion (cahier « parcours de connexion ») :
   * contrastes vérifiés, tous ≥ 4,5:1 sur blanc et sur le fond gris.
   */
  auth: {
    page: '#F3F7FA', // fond de page
    ink: '#13233A', // texte principal (15,8:1 sur blanc)
    muted: '#52627A', // texte secondaire (6,2:1 sur blanc)
    primary: '#1957B8', // bouton principal et liens (6,8:1)
    'primary-hover': '#123F86',
    mint: '#E3F6EA', // touche discrète : fond du logo, confirmation
    error: '#9A2620', // erreurs (7,9:1)
    line: '#7D8DA3', // bordure des champs (3,4:1 sur blanc, seuil WCAG des contours : 3:1)
  },
} as const;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors,
    extend: {
      fontFamily: {
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
        jakarta: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        small: ['13px', { lineHeight: '18px', fontWeight: '600' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px' }],
        'card-title': ['17px', { lineHeight: '24px', fontWeight: '800' }],
        section: ['20px', { lineHeight: '26px', fontWeight: '700' }],
        'page-title': ['26px', { lineHeight: '30px', fontWeight: '800' }],
        stat: ['28px', { lineHeight: '32px', fontWeight: '800' }],
        amount: ['34px', { lineHeight: '38px', fontWeight: '800' }],
      },
      borderRadius: { card: '16px', control: '12px', pill: '999px' },
      boxShadow: {
        card: '0 4px 14px rgba(18, 64, 122, 0.08)',
        float: '0 12px 28px rgba(18, 64, 122, 0.16)',
      },
      borderWidth: { 3: '3px' },
      transitionDuration: { 250: '250ms' },
      spacing: { page: '16px', 'page-sm': '24px' },
      minHeight: { touch: '44px', button: '48px' },
      minWidth: { touch: '44px' },
      // participantWide : espace membre sur ordinateur (deux colonnes).
      maxWidth: { participant: '560px', participantWide: '1040px', admin: '1280px' },
      keyframes: {
        'check-pop': {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '70%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // Arrivée d'un écran de connexion : léger glissement depuis la droite.
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // Feuille du bas (bottom sheet) qui monte depuis le bord de l'écran.
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'none' },
        },
        // Code ou PIN faux : les cases tremblent brièvement.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'check-pop': 'check-pop 400ms ease-out both',
        'fade-in': 'fade-in 250ms ease-out both',
        'slide-in': 'slide-in 200ms ease-out both',
        shake: 'shake 320ms ease-in-out',
        'sheet-up': 'sheet-up 220ms ease-out both',
      },
    },
  },
  plugins: [],
} satisfies Config;
