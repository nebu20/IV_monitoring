import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Props { critical: number; attention: number; normal: number; stale: number; }

export function SummaryBar({ critical, attention, normal, stale }: Props) {
  const { theme } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: theme.bg.secondary, borderColor: theme.border }]}>
      <Chip label="Critical" count={critical} color={theme.status.critical} theme={theme} />
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <Chip label="Attention" count={attention} color={theme.status.advisory} theme={theme} />
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <Chip label="Normal" count={normal} color={theme.status.normal} theme={theme} />
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <Chip label="Stale" count={stale} color={theme.text.muted} theme={theme} />
    </View>
  );
}

function Chip({ label, count, color, theme }: { label: string; count: number; color: string; theme: any }) {
  return (
    <View style={styles.chip}>
      <Text style={[styles.count, { color }]}>{count}</Text>
      <Text style={[styles.label, { color: theme.text.secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1 },
  chip: { flex: 1, alignItems: 'center', gap: 2 },
  count: { fontSize: Typography['2xl'], fontWeight: '800', lineHeight: 28 },
  label: { fontSize: Typography.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { width: 1, height: 32 },
});
