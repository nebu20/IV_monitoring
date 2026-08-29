import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Typography, Radius } from '../constants/theme';

interface Props { percentage: number; volumeMl: number; bagSizeMl: number; }

export function VolumeBar({ percentage, volumeMl, bagSizeMl }: Props) {
  const { theme } = useTheme();
  const pct = Math.max(0, Math.min(100, percentage));
  const color = pct < 10 ? theme.status.critical : pct < 30 ? theme.status.advisory : theme.status.normal;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.volumeText, { color: theme.text.primary }]}>{Math.round(volumeMl)} mL</Text>
        <Text style={[styles.pctText, { color }]}>{pct.toFixed(0)}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.bg.input }]}>
        <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[styles.bagSize, { color: theme.text.muted }]}>of {Math.round(bagSizeMl)} mL</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  volumeText: { fontSize: Typography.lg, fontWeight: '700' },
  pctText: { fontSize: Typography.md, fontWeight: '700' },
  track: { height: 8, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  bagSize: { fontSize: Typography.xs },
});
