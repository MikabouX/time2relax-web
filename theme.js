'use strict';

/* ---------- Couleurs et mode clair / sombre ----------
   Mêmes choix que dans l'appli : la couleur d'un des 7 chakras et le mode Auto / Clair / Sombre.
   Toutes les teintes de la page (fond, cartes, boutons) sont calculées à partir de cette couleur. */

// Les 7 chakras, de la racine à la couronne : couleurs de l'affiche des 7 chakras (comme dans l'appli).
const CHAKRAS = [
  { key: 'root', color: '#B82820', sound: 'LAM', sanskrit: 'Muladhara' },
  { key: 'sacral', color: '#E87C4E', sound: 'VAM', sanskrit: 'Svadhisthana' },
  { key: 'solar', color: '#F0DC50', sound: 'RAM', sanskrit: 'Manipura' },
  { key: 'heart', color: '#388528', sound: 'YAM', sanskrit: 'Anahata' },
  { key: 'throat', color: '#4084C4', sound: 'HAM', sanskrit: 'Vishuddha' },
  { key: 'third_eye', color: '#48108A', sound: 'OM', sanskrit: 'Ajna' },
  { key: 'crown', color: '#A868B0', sound: 'AH', sanskrit: 'Sahasrara' },
];
const THEME_COLORS = Object.fromEntries(CHAKRAS.map((c) => [c.key, c.color]));
// Couleur par défaut : le cœur (vert), comme le centre de l'icône — la paix qui vient de l'intérieur.
const DEFAULT_CHAKRA = 'heart';
// Anciennes couleurs : reprises vers le chakra le plus proche.
const LEGACY_COLORS = { teal: 'heart', green: 'heart', pink: 'heart', blue: 'throat', purple: 'crown', red: 'root', brown: 'root', orange: 'sacral' };
const chakraKey = (v) => (typeof v !== 'string' ? null : (THEME_COLORS[v] ? v : (LEGACY_COLORS[v] || null)));
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
  const [h0, s0] = hueSat(hex);
  const h = h0 >= 45 && h0 <= 65 ? h0 - 12 : h0; // jaune : plus doré, pour rester lisible sur blanc
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

// Couleurs qui ne dépendent que du mode (erreur, ambre, bleu du lunch) : celles de la feuille de style.
const FIXED = {
  light: { '--tertiary': '#4A6A8A', '--tertiary-c': '#D3E4F7', '--on-tertiary-c': '#0A1D2E', '--error': '#BA1A1A', '--on-error': '#FFFFFF', '--amber': '#F59E0B' },
  dark: { '--tertiary': '#A8C8E8', '--tertiary-c': '#2E4A66', '--on-tertiary-c': '#D3E4F7', '--error': '#FFB4AB', '--on-error': '#561E19', '--amber': '#FBBF24' },
};

/** Applique la couleur (chakra) et le mode choisis à toute la page. */
function applyTheme() {
  const color = chakraKey(S.prefs.themeColor) || DEFAULT_CHAKRA;
  const mode = THEME_MODES.includes(S.prefs.themeMode) ? S.prefs.themeMode : 'system';
  const root = document.documentElement;
  const dark = mode === 'dark' || (mode === 'system' && !!(darkQuery && darkQuery.matches));
  const key = dark ? 'dark' : 'light';
  root.removeAttribute('style');
  const vars = Object.assign({}, FIXED[key], themeVars(THEME_COLORS[color], dark));
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.colorScheme = key;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[color]);
}

if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme());
