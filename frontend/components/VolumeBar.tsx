/**
 * VolumeBar — Horizontal progress bar showing remaining IV fluid percentage.
 * Colour shifts: green > 30%, amber 10-30%, red < 10%.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

interface Props {
  percentage: number;
  volumeMl: number;
  bagSizeMl: number;
}

function getBarColor(pct: number): string {
  if (pct < 10) return Colors.status.critical;
  if (pct < 30) return Colors.status.advisory;
  return Colors.status.normal;
}

export function VolumeBar({ percentage, volumeMl, bagSizeMl }: Props) {
  const clampedPct = Math.max(0, Math.min(100, percentage));
  const color = getBarColor(clampedPct);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.volumeText}>
          {Math.round(volumeMl)} mL
        </Text>
        <Text style={[styles.pctText, { color }]}>
          {clampedPct.toFixed(0)}%
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${clampedPct}%` as any, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.bagSize}>of {Math.round(bagSizeMl)} mL</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  volumeText: {
    color: Colors.text.primary,
    fontSize: Typography.lg,
    fontWeight: '700',
  },
  pctText: {
    fontSize: Typography.md,
    fontWeight: '700',
  },
  track: {
    height: 8,
    backgroundColor: Colors.bg.input,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  bagSize: {
    color: Colors.text.secondary,
    fontSize: Typography.xs,
  },
});
