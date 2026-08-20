/**
 * StatusBadge — Pill-shaped badge indicating flow/alarm status.
 * Maps FlowStatus to clinical colour coding.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FlowStatus } from '../types';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

const STATUS_CONFIG: Record<
  FlowStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  NORMAL: {
    label: 'Flow Normal',
    color: Colors.status.normal,
    bg: Colors.status.normalBg,
    border: Colors.status.normalBorder,
  },
  ADVISORY: {
    label: 'Advisory',
    color: Colors.status.advisory,
    bg: Colors.status.advisoryBg,
    border: Colors.status.advisoryBorder,
  },
  CRITICAL: {
    label: 'No Flow — Assess Line',
    color: Colors.status.critical,
    bg: Colors.status.criticalBg,
    border: Colors.status.criticalBorder,
  },
  HIGH_PRIORITY: {
    label: 'Line Discrepancy',
    color: Colors.status.high,
    bg: Colors.status.highBg,
    border: Colors.status.highBorder,
  },
  ANOMALY: {
    label: 'Sensor Anomaly',
    color: Colors.status.anomaly,
    bg: Colors.status.anomalyBg,
    border: Colors.status.anomalyBorder,
  },
};

interface Props {
  status: FlowStatus;
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ANOMALY;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: cfg.bg,
          borderColor: cfg.border,
        },
        compact && styles.compact,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text
        style={[
          styles.label,
          { color: cfg.color },
          compact && styles.labelCompact,
        ]}
        numberOfLines={1}
      >
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    gap: 5,
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  labelCompact: {
    fontSize: 10,
  },
});
