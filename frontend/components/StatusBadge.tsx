import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FlowStatus } from '../types';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Props { status: FlowStatus; compact?: boolean; }

export function StatusBadge({ status, compact = false }: Props) {
  const { theme } = useTheme();

  const cfg = {
    NORMAL:       { label: 'Flow Normal',       color: theme.status.normal,   bg: theme.status.normalBg,   border: theme.status.normalBorder },
    ADVISORY:     { label: 'Advisory',           color: theme.status.advisory, bg: theme.status.advisoryBg, border: theme.status.advisoryBorder },
    CRITICAL:     { label: 'No Flow — Assess',   color: theme.status.critical, bg: theme.status.criticalBg, border: theme.status.criticalBorder },
    HIGH_PRIORITY:{ label: 'Line Discrepancy',   color: theme.status.high,     bg: theme.status.highBg,     border: theme.status.highBorder },
    ANOMALY:      { label: 'Sensor Anomaly',     color: theme.status.anomaly,  bg: theme.status.anomalyBg,  border: theme.status.anomalyBorder },
  }[status] ?? { label: 'Unknown', color: theme.text.muted, bg: theme.bg.input, border: theme.border };

  return (
    <View style={[{ backgroundColor: cfg.bg, borderColor: cfg.border }, styles.badge, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.label, { color: cfg.color }, compact && styles.labelCompact]} numberOfLines={1}>
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.full, borderWidth: 1, gap: 5, alignSelf: 'flex-start' },
  compact: { paddingHorizontal: 6, paddingVertical: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: Typography.xs, fontWeight: '600', letterSpacing: 0.3 },
  labelCompact: { fontSize: 10 },
});
