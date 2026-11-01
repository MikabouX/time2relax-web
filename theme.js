'use strict';

/* ---------- Couleurs et mode clair / sombre ----------
   Mêmes choix que dans l'appli : une couleur de base (8 pastilles) et le mode Auto / Clair / Sombre.
   Toutes les teintes de la page (fond, cartes, boutons) sont calculées à partir de cette couleur. */

const THEME_COLORS = {
  teal: '#0F766E',
  blue: '#2563EB',
  green: '#16A34A',
  orange: '#EA580C',
  red: '#DC2626',
  pink: '#DB2777',
  purple: '#7C3AED',
  brown: '#8D6E63',
};
const THEME_MODES = ['system', 'light', 'dark'];

/** Teinte (0–360) et saturation (0–100) d'une couleur #RRGGBB. */
function hueSat(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round(h * 60 + 360) % 360;
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, Math.round(s * 100)];
}

/** Les variables CSS de la page pour une couleur et un mode (clair ou sombre). */
function themeVars(hex, dark) {
  const [h, s0] = hueSat(hex);
  const s = Math.min(s0, 90);
  const c = (sat, light) => `hsl(${h} ${Math.round(sat)}% ${light}%)`;
  const tint = Math.min(s, 35); // fonds légèrement teintés
  return dark
    ? {
      '--bg': c(tint * 0.5, 7), '--surface': c(tint * 0.45, 9), '--low': c(tint * 0.4, 12),
      '--high': c(tint * 0.35, 16), '--highest': c(tint * 0.3, 20),
      '--primary': c(s * 0.75, 66), '--on-primary': c(s, 9),
      '--primary-c': c(s, 18), '--on-primary-c': c(s * 0.8, 86),
      '--secondary-c': c(tint * 0.7, 24), '--on-secondary-c': c(tint, 87),
      '--text': c(tint * 0.3, 88), '--muted': c(tint * 0.25, 68), '--outline': c(tint * 0.3, 28),
    }
    : {
      '--bg': c(tint * 0.7, 97), '--surface': '#FFFFFF', '--low': c(tint * 0.6, 93),
      '--high': c(tint * 0.5, 89), '--highest': c(tint * 0.4, 85),
      '--primary': c(s, 36), '--on-primary': '#FFFFFF',
      '--primary-c': c(s * 0.7, 85), '--on-primary-c': c(s, 9),
      '--secondary-c': c(tint, 86), '--on-secondary-c': c(tint, 12),
      '--text': c(tint * 0.4, 10), '--muted': c(tint * 0.3, 32), '--outline': c(tint * 0.3, 77),
    };
}

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

// Couleur d'origine (sarcelle) : les teintes exactes de la feuille de style.
const TEAL = {
  light: {
    '--bg': '#F4F8F7', '--surface': '#FFFFFF', '--low': '#EAF1F0', '--high': '#DFE8E7', '--highest': '#D3DDDC',
    '--primary': '#0F766E', '--on-primary': '#FFFFFF', '--primary-c': '#BDEBE5', '--on-primary-c': '#00201D',
    '--secondary-c': '#CDE8E3', '--on-secondary-c': '#0B2724', '--text': '#161D1C', '--muted': '#4A5655', '--outline': '#BEC9C6',
  },
  dark: {
    '--bg': '#0E1514', '--surface': '#131A19', '--low': '#1A2221', '--high': '#242D2C', '--highest': '#2F3837',
    '--primary': '#5CD6C8', '--on-primary': '#00201D', '--primary-c': '#00504A', '--on-primary-c': '#A0F2E8',
    '--secondary-c': '#304B47', '--on-secondary-c': '#CDE8E3', '--text': '#DEE4E2', '--muted': '#A9B5B2', '--outline': '#3F4947',
  },
};
// Couleurs qui ne dépendent que du mode (erreur, ambre, bleu du lunch) : celles de la feuille de style.
const FIXED = {
  light: { '--tertiary': '#4A6A8A', '--tertiary-c': '#D3E4F7', '--on-tertiary-c': '#0A1D2E', '--error': '#BA1A1A', '--on-error': '#FFFFFF', '--amber': '#F59E0B' },
  dark: { '--tertiary': '#A8C8E8', '--tertiary-c': '#2E4A66', '--on-tertiary-c': '#D3E4F7', '--error': '#FFB4AB', '--on-error': '#561E19', '--amber': '#FBBF24' },
};

/** Applique la couleur et le mode choisis à toute la page. */
function applyTheme() {
  const color = THEME_COLORS[S.prefs.themeColor] ? S.prefs.themeColor : 'teal';
  const mode = THEME_MODES.includes(S.prefs.themeMode) ? S.prefs.themeMode : 'system';
  const root = document.documentElement;
  root.removeAttribute('style');
  if (color === 'teal' && mode === 'system') {
    // Réglage d'origine : la feuille de style suit seule le mode du système.
    root.style.colorScheme = 'light dark';
  } else {
    const dark = mode === 'dark' || (mode === 'system' && !!(darkQuery && darkQuery.matches));
    const key = dark ? 'dark' : 'light';
    const vars = Object.assign({}, FIXED[key], color === 'teal' ? TEAL[key] : themeVars(THEME_COLORS[color], dark));
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.colorScheme = key;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[color]);
}

if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme());
