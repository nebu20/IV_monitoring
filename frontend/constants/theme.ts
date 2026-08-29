/**
 * Clinical Design System — Dark & Light themes
 * Status colours stay the same in both modes (clinical standard).
 * Only backgrounds, surfaces, text, and borders switch.
 */

// ── Shared status colours (never change between themes) ───────────────────────
export const StatusColors = {
  normal:         '#22c55e',
  normalBg_dark:  '#052e16',
  normalBg_light: '#dcfce7',
  normalBorder:   '#166534',

  advisory:         '#f59e0b',
  advisoryBg_dark:  '#451a03',
  advisoryBg_light: '#fef3c7',
  advisoryBorder:   '#92400e',

  critical:         '#ef4444',
  criticalBg_dark:  '#450a0a',
  criticalBg_light: '#fee2e2',
  criticalBorder:   '#991b1b',

  high:         '#f97316',
  highBg_dark:  '#431407',
  highBg_light: '#ffedd5',
  highBorder:   '#9a3412',

  anomaly:         '#a78bfa',
  anomalyBg_dark:  '#2e1065',
  anomalyBg_light: '#ede9fe',
  anomalyBorder:   '#5b21b6',
};

// ── Dark theme ────────────────────────────────────────────────────────────────
export const DarkTheme = {
  mode: 'dark' as const,

  bg: {
    primary:   '#0f172a',
    secondary: '#1e293b',
    card:      '#1e293b',
    input:     '#334155',
    modal:     '#1e293b',
  },
  text: {
    primary:   '#f1f5f9',
    secondary: '#94a3b8',
    muted:     '#475569',
    inverse:   '#0f172a',
  },
  status: {
    normal:       StatusColors.normal,
    normalBg:     StatusColors.normalBg_dark,
    normalBorder: StatusColors.normalBorder,
    advisory:       StatusColors.advisory,
    advisoryBg:     StatusColors.advisoryBg_dark,
    advisoryBorder: StatusColors.advisoryBorder,
    critical:       StatusColors.critical,
    criticalBg:     StatusColors.criticalBg_dark,
    criticalBorder: StatusColors.criticalBorder,
    high:       StatusColors.high,
    highBg:     StatusColors.highBg_dark,
    highBorder: StatusColors.highBorder,
    anomaly:       StatusColors.anomaly,
    anomalyBg:     StatusColors.anomalyBg_dark,
    anomalyBorder: StatusColors.anomalyBorder,
    offline:        '#475569',
    offlineBg:      '#0f172a',
    offlineBorder:  '#334155',
  },
  alarmBg:     '#7f1d1d',
  alarmText:   '#fca5a5',
  alarmBorder: '#ef4444',
  border:      '#334155',
  borderLight: '#1e293b',
  accent:      '#3b82f6',
  accentDark:  '#1d4ed8',
  accentMuted: '#1e3a5f',
  white: '#ffffff',
  black: '#000000',
};

// ── Light theme ───────────────────────────────────────────────────────────────
export const LightTheme = {
  mode: 'light' as const,

  bg: {
    primary:   '#f1f5f9',
    secondary: '#ffffff',
    card:      '#ffffff',
    input:     '#e2e8f0',
    modal:     '#ffffff',
  },
  text: {
    primary:   '#0f172a',
    secondary: '#334155',
    muted:     '#94a3b8',
    inverse:   '#ffffff',
  },
  status: {
    normal:       '#16a34a',
    normalBg:     StatusColors.normalBg_light,
    normalBorder: '#86efac',
    advisory:       '#d97706',
    advisoryBg:     StatusColors.advisoryBg_light,
    advisoryBorder: '#fcd34d',
    critical:       '#dc2626',
    criticalBg:     StatusColors.criticalBg_light,
    criticalBorder: '#fca5a5',
    high:       '#ea580c',
    highBg:     StatusColors.highBg_light,
    highBorder: '#fdba74',
    anomaly:       '#7c3aed',
    anomalyBg:     StatusColors.anomalyBg_light,
    anomalyBorder: '#c4b5fd',
    offline:        '#94a3b8',
    offlineBg:      '#f1f5f9',
    offlineBorder:  '#cbd5e1',
  },
  alarmBg:     '#fee2e2',
  alarmText:   '#991b1b',
  alarmBorder: '#ef4444',
  border:      '#e2e8f0',
  borderLight: '#f1f5f9',
  accent:      '#2563eb',
  accentDark:  '#1d4ed8',
  accentMuted: '#dbeafe',
  white: '#ffffff',
  black: '#000000',
};

export type Theme = typeof DarkTheme;

export const Typography = {
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
