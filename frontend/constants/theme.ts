/**
 * Clinical Dark Mode Design System
 * Strict high-contrast colour coding:
 *   Green  → NORMAL
 *   Amber  → ADVISORY / LOW priority
 *   Red    → CRITICAL / HIGH priority
 *   Grey   → Offline / Stale
 */

export const Colors = {
  // Backgrounds
  bg: {
    primary:   '#0f172a',   // slate-900
    secondary: '#1e293b',   // slate-800
    card:      '#1e293b',
    input:     '#334155',   // slate-700
    modal:     '#1e293b',
  },

  // Text
  text: {
    primary:   '#f1f5f9',   // slate-100
    secondary: '#94a3b8',   // slate-400
    muted:     '#475569',   // slate-600
    inverse:   '#0f172a',
  },

  // Status colours
  status: {
    normal:       '#22c55e',   // green-500
    normalBg:     '#052e16',   // green-950
    normalBorder: '#166534',   // green-800

    advisory:       '#f59e0b',   // amber-500
    advisoryBg:     '#451a03',   // amber-950
    advisoryBorder: '#92400e',   // amber-800

    critical:       '#ef4444',   // red-500
    criticalBg:     '#450a0a',   // red-950
    criticalBorder: '#991b1b',   // red-800

    high:           '#f97316',   // orange-500
    highBg:         '#431407',   // orange-950
    highBorder:     '#9a3412',   // orange-800

    anomaly:        '#a78bfa',   // violet-400
    anomalyBg:      '#2e1065',   // violet-950
    anomalyBorder:  '#5b21b6',   // violet-800

    offline:        '#475569',   // slate-600
    offlineBg:      '#0f172a',
    offlineBorder:  '#334155',
  },

  // Priority flash colours for alarm banner
  alarmBg:     '#7f1d1d',   // red-900
  alarmText:   '#fca5a5',   // red-300
  alarmBorder: '#ef4444',

  // Borders
  border: '#334155',         // slate-700
  borderLight: '#1e293b',

  // Interactive
  accent:       '#3b82f6',   // blue-500
  accentDark:   '#1d4ed8',   // blue-700
  accentMuted:  '#1e3a5f',

  white: '#ffffff',
  black: '#000000',
};

export const Typography = {
  // Font sizes (clinical — large and readable)
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   24,
  '2xl': 28,
  '3xl': 34,
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
};

export const Radius = {
  sm:  6,
  md:  10,
  lg:  14,
  xl:  20,
  full: 9999,
};
