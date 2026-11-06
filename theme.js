'use strict';

/* ---------- Couleurs ----------
   La page web a une seule apparence : un gris un peu clair, sans réglage de couleur ni de mode.
   (Les clés de couleur ci-dessous ne servent plus qu'à relire d'anciens réglages ; rien n'est affiché.) */

const THEME_COLORS = { root: '#B82820', sacral: '#E87C4E', solar: '#F0DC50', heart: '#388528', throat: '#4084C4', third_eye: '#48108A', crown: '#A868B0' };
const DEFAULT_COLOR = 'heart';
const LEGACY_COLORS = { teal: 'heart', green: 'heart', pink: 'heart', blue: 'throat', purple: 'crown', red: 'root', brown: 'root', orange: 'sacral' };
const colorKey = (v) => (typeof v !== 'string' ? null : (THEME_COLORS[v] ? v : (LEGACY_COLORS[v] || null)));
const THEME_MODES = ['system', 'light', 'dark'];

// Couleurs fixes (erreur, ambre, bleu du lunch) : celles de la feuille de style.
const FIXED = {
  light: { '--tertiary': '#4A6A8A', '--tertiary-c': '#D3E4F7', '--on-tertiary-c': '#0A1D2E', '--error': '#BA1A1A', '--on-error': '#FFFFFF', '--amber': '#F59E0B' },
  dark: { '--tertiary': '#A8C8E8', '--tertiary-c': '#2E4A66', '--on-tertiary-c': '#D3E4F7', '--error': '#FFB4AB', '--on-error': '#561E19', '--amber': '#FBBF24' },
};

/** Le gris de la page (un gris un peu clair), toujours le même. */
const GREY = {
  '--bg': '#E8EAED', '--surface': '#F6F7F8', '--low': '#E0E3E7', '--high': '#D5D9DE', '--highest': '#CACFD5',
  '--primary': '#5B636D', '--on-primary': '#FFFFFF',
  '--primary-c': '#D2D6DB', '--on-primary-c': '#1E2329',
  '--secondary-c': '#DADDE1', '--on-secondary-c': '#22272D',
  '--text': '#1C2024', '--muted': '#535A62', '--outline': '#B7BCC3',
};

/** Palette claire tirée de la couleur de l'appli (même teinte que sur le téléphone). */
function palette(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let hue = 0;
  if (mx !== mn) {
    const d = mx - mn;
    hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = Math.round(hue * 60 + 360) % 360;
  }
  const c = (s, l) => `hsl(${hue} ${s}% ${l}%)`;
  return {
    '--bg': c(22, 94), '--surface': c(25, 98), '--low': c(20, 91), '--high': c(18, 87), '--highest': c(16, 83),
    '--primary': c(45, 36), '--on-primary': '#FFFFFF',
    '--primary-c': c(55, 87), '--on-primary-c': c(60, 14),
    '--secondary-c': c(28, 87), '--on-secondary-c': c(30, 16),
    '--text': c(15, 11), '--muted': c(8, 36), '--outline': c(10, 72),
  };
}

/** La couleur de l'appli, si le cocker l'a rapportée (nom d'utilisateur synchronisé). */
function phoneColorKey() {
  try { return colorKey(localStorage.getItem('t2r.phoneColor')); } catch (_) { return null; }
}

/** Applique le gris de la page, ou la couleur de l'appli quand elle est connue (toujours en mode clair). */
function applyTheme() {
  const root = document.documentElement;
  root.removeAttribute('style');
  const k = phoneColorKey();
  const base = k ? palette(THEME_COLORS[k]) : GREY;
  const vars = Object.assign({}, FIXED.light, base);
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.colorScheme = 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', k ? base['--primary'] : GREY['--bg']);
}

