/**
 * SummaryBar — Unit-wide counts bar shown at the top of the dashboard.
 * "Critical: 2 | Attention: 4 | Normal: 18 | Stale: 0"
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

interface Props {
  critical: number;
  attention: number;
  normal: number;
  stale: number;
}

export function SummaryBar({ critical, attention, normal, stale }: Props) {
  return (
    <View style={styles.bar}>
      <CountChip label="Critical" count={critical} color={Colors.status.critical} />
      <Divider />
      <CountChip label="Attention" count={attention} color={Colors.status.advisory} />
      <Divider />
      <CountChip label="Normal" count={normal} color={Colors.status.normal} />
      <Divider />
      <CountChip label="Stale" count={stale} color={Colors.text.muted} />
    </View>
  );
}

function CountChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={styles.chip}>
      <Text style={[styles.count, { color }]}>{count}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.secondary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  count: {
    fontSize: Typography['2xl'],
    fontWeight: '800',
    lineHeight: 28,
  },
  label: {
    color: Colors.text.secondary,
    fontSize: Typography.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.border,
  },
});
