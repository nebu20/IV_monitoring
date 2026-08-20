/**
 * PatientCard — Compact bed card for the central dashboard grid.
 * Designed to show maximum cards at once while keeping all info readable.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { TelemetryState, AlarmPriority } from '../types';
import { StatusBadge } from './StatusBadge';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

const PRIORITY_BORDER: Record<AlarmPriority, string> = {
  CRITICAL: Colors.status.critical,
  HIGH:     Colors.status.high,
  LOW:      Colors.status.advisory,
  NORMAL:   Colors.border,
};

const PRIORITY_CARD_BG: Record<AlarmPriority, string> = {
  CRITICAL: '#1a0505',
  HIGH:     '#1a0a00',
  LOW:      '#1a1400',
  NORMAL:   Colors.bg.card,
};

interface Props {
  state: TelemetryState;
  onAcknowledge: (ivId: string) => void;
  onDetails: (ivId: string) => void;
}

export function PatientCard({ state, onAcknowledge, onDetails }: Props) {
  const borderColor = PRIORITY_BORDER[state.alarm_priority];
  const cardBg = PRIORITY_CARD_BG[state.alarm_priority];
  const isAlarm = state.alarm_priority === 'CRITICAL' || state.alarm_priority === 'HIGH';
  const isAcknowledged = state.alarm_acknowledged;
  const clampedPct = Math.max(0, Math.min(100, state.percentage));

  const barColor =
    clampedPct < 10 ? Colors.status.critical :
    clampedPct < 30 ? Colors.status.advisory :
    Colors.status.normal;

  const lastUpdateAgo = (() => {
    try { return formatDistanceToNow(new Date(state.last_update), { addSuffix: true }); }
    catch { return '—'; }
  })();

  return (
    <View style={[styles.card, { borderTopColor: borderColor, backgroundColor: cardBg }]}>

      {/* ── Row 1: Room + IV ID + unack dot ── */}
      <View style={styles.row1}>
        <View style={styles.roomPill}>
          <Ionicons name="bed-outline" size={11} color={Colors.text.secondary} />
          <Text style={styles.roomText}>{state.room_bed}</Text>
        </View>
        <Text style={styles.ivId} numberOfLines={1}>{state.iv_id}</Text>
        {isAlarm && !isAcknowledged && <View style={styles.alarmDot} />}
      </View>

      {/* ── Row 2: Patient name ── */}
      <Text style={styles.patientName} numberOfLines={1}>{state.patient_name}</Text>

      {/* ── Row 3: Fluid + Status badge ── */}
      <View style={styles.row3}>
        <Text style={styles.fluidName} numberOfLines={1}>{state.fluid_name}</Text>
        <StatusBadge status={state.flow_status} compact />
      </View>

      {/* ── Volume bar ── */}
      <View style={styles.volumeSection}>
        <View style={styles.volumeLabelRow}>
          <Text style={styles.volumeMl}>{Math.round(state.volume_ml)} mL</Text>
          <Text style={[styles.volumePct, { color: barColor }]}>{clampedPct.toFixed(0)}%</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${clampedPct}%` as any, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.bagOf}>of {Math.round(state.bag_size_ml)} mL</Text>
      </View>

      {/* ── Metrics row ── */}
      <View style={styles.metricsRow}>
        <Metric icon="water-outline" value={`${state.drip_rate_gtt_min.toFixed(0)} gtt/min`} color={Colors.accent} />
        <Metric
          icon="time-outline"
          value={state.eta_string}
          color={state.eta_string === 'ETA Unavailable' ? Colors.status.critical : Colors.status.normal}
        />
        <Metric icon="speedometer-outline" value={`Rx ${state.prescribed_rate_gtt_min} gtt`} color={Colors.text.muted} />
      </View>

      {/* ── Footer: timestamp + buttons ── */}
      <View style={styles.footer}>
        <Text style={styles.timestamp} numberOfLines={1}>↻ {lastUpdateAgo}</Text>
        <View style={styles.btnRow}>
          {isAlarm && !isAcknowledged && (
            <TouchableOpacity
              style={[styles.btn, styles.btnAck]}
              onPress={() => onAcknowledge(state.iv_id)}
              accessibilityLabel="Acknowledge alarm"
            >
              <Ionicons name="checkmark-circle-outline" size={13} color={Colors.status.advisory} />
              <Text style={[styles.btnTxt, { color: Colors.status.advisory }]}>Ack</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btn, styles.btnDetails]}
            onPress={() => onDetails(state.iv_id)}
            accessibilityLabel="View details"
          >
            <Ionicons name="analytics-outline" size={13} color={Colors.accent} />
            <Text style={[styles.btnTxt, { color: Colors.accent }]}>Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function Metric({ icon, value, color }: { icon: string; value: string; color: string }) {
  return (
    <View style={mStyles.chip}>
      <Ionicons name={icon as any} size={11} color={color} />
      <Text style={[mStyles.val, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 3,
    padding: Spacing.md,
    gap: 7,
    // shadow for web
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.input,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    gap: 3,
  },
  roomText: {
    color: Colors.text.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  ivId: {
    flex: 1,
    color: Colors.text.muted,
    fontSize: 10,
  },
  alarmDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.status.critical,
  },
  patientName: {
    color: Colors.text.primary,
    fontSize: Typography.base,
    fontWeight: '700',
    lineHeight: 20,
  },
  row3: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  fluidName: {
    color: Colors.text.secondary,
    fontSize: 11,
    flex: 1,
  },
  volumeSection: {
    gap: 3,
  },
  volumeLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  volumeMl: {
    color: Colors.text.primary,
    fontSize: Typography.md,
    fontWeight: '700',
  },
  volumePct: {
    fontSize: Typography.sm,
    fontWeight: '700',
  },
  track: {
    height: 6,
    backgroundColor: Colors.bg.input,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  bagOf: {
    color: Colors.text.muted,
    fontSize: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 5,
    flexWrap: 'wrap',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    gap: 6,
  },
  timestamp: {
    color: Colors.text.muted,
    fontSize: 10,
    flex: 1,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 5,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 3,
  },
  btnAck: {
    borderColor: Colors.status.advisoryBorder,
    backgroundColor: Colors.status.advisoryBg,
  },
  btnDetails: {
    borderColor: Colors.accentMuted,
    backgroundColor: Colors.accentMuted,
  },
  btnTxt: {
    fontSize: 11,
    fontWeight: '600',
  },
});

const mStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.input,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    gap: 3,
  },
  val: {
    fontSize: 10,
    fontWeight: '600',
  },
});
