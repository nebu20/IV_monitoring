import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { TelemetryState, AlarmPriority } from '../types';
import { StatusBadge } from './StatusBadge';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Props {
  state: TelemetryState;
  onAcknowledge: (ivId: string) => void;
  onDetails: (ivId: string) => void;
  onEndSession?: (ivId: string) => void;
}

export function PatientCard({ state, onAcknowledge, onDetails, onEndSession }: Props) {
  const { theme } = useTheme();

  const borderColor: Record<AlarmPriority, string> = {
    CRITICAL: theme.status.critical,
    HIGH:     theme.status.high,
    LOW:      theme.status.advisory,
    NORMAL:   theme.border,
  };

  const cardAlarmBg: Record<AlarmPriority, string> = {
    CRITICAL: theme.status.criticalBg,
    HIGH:     theme.status.highBg,
    LOW:      theme.status.advisoryBg,
    NORMAL:   theme.bg.card,
  };

  const isAlarm = state.alarm_priority === 'CRITICAL' || state.alarm_priority === 'HIGH';
  const isAcknowledged = state.alarm_acknowledged;
  const pct = Math.max(0, Math.min(100, state.percentage));
  const barColor = pct < 10 ? theme.status.critical : pct < 30 ? theme.status.advisory : theme.status.normal;

  const lastUpdateAgo = (() => {
    try { return formatDistanceToNow(new Date(state.last_update), { addSuffix: true }); }
    catch { return '—'; }
  })();

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: cardAlarmBg[state.alarm_priority],
        borderColor: theme.border,
        borderTopColor: borderColor[state.alarm_priority],
        shadowColor: theme.mode === 'dark' ? '#000' : '#94a3b8',
      }
    ]}>
      {/* Row 1: Room + IV ID + unack dot */}
      <View style={styles.row1}>
        <View style={[styles.roomPill, { backgroundColor: theme.bg.input }]}>
          <Ionicons name="bed-outline" size={11} color={theme.text.secondary} />
          <Text style={[styles.roomText, { color: theme.text.primary }]}>{state.room_bed}</Text>
        </View>
        <Text style={[styles.ivId, { color: theme.text.muted }]} numberOfLines={1}>{state.iv_id}</Text>
        {isAlarm && !isAcknowledged && <View style={[styles.alarmDot, { backgroundColor: theme.status.critical }]} />}
      </View>

      {/* Patient name */}
      <Text style={[styles.patientName, { color: theme.text.primary }]} numberOfLines={1}>{state.patient_name}</Text>

      {/* Fluid + Status badge */}
      <View style={styles.row3}>
        <Text style={[styles.fluidName, { color: theme.text.secondary }]} numberOfLines={1}>{state.fluid_name}</Text>
        <StatusBadge status={state.flow_status} compact />
      </View>

      {/* Volume bar */}
      <View style={styles.volumeSection}>
        <View style={styles.volumeLabelRow}>
          <Text style={[styles.volumeMl, { color: theme.text.primary }]}>{Math.round(state.volume_ml)} mL</Text>
          <Text style={[styles.volumePct, { color: barColor }]}>{pct.toFixed(0)}%</Text>
        </View>
        <View style={[styles.track, { backgroundColor: theme.bg.input }]}>
          <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
        </View>
        <Text style={[styles.bagOf, { color: theme.text.muted }]}>of {Math.round(state.bag_size_ml)} mL</Text>
      </View>

      {/* Metrics */}
      <View style={styles.metricsRow}>
        <Metric theme={theme} icon="water-outline" value={`${state.drip_rate_gtt_min.toFixed(0)} gtt/min`} color={theme.accent} />
        <Metric theme={theme} icon="time-outline" value={state.eta_string}
          color={state.eta_string === 'ETA Unavailable' ? theme.status.critical : theme.status.normal} />
        <Metric theme={theme} icon="speedometer-outline" value={`Rx ${state.prescribed_rate_gtt_min}`} color={theme.text.muted} />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.timestamp, { color: theme.text.muted }]} numberOfLines={1}>↻ {lastUpdateAgo}</Text>
        <View style={styles.btnRow}>
          {isAlarm && !isAcknowledged && (
            <TouchableOpacity
              style={[styles.btn, { borderColor: theme.status.advisoryBorder, backgroundColor: theme.status.advisoryBg }]}
              onPress={() => onAcknowledge(state.iv_id)}
            >
              <Ionicons name="checkmark-circle-outline" size={13} color={theme.status.advisory} />
              <Text style={[styles.btnTxt, { color: theme.status.advisory }]}>Ack</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btn, { borderColor: theme.accentMuted, backgroundColor: theme.accentMuted }]}
            onPress={() => onDetails(state.iv_id)}
          >
            <Ionicons name="analytics-outline" size={13} color={theme.accent} />
            <Text style={[styles.btnTxt, { color: theme.accent }]}>Details</Text>
          </TouchableOpacity>
          {onEndSession && (
            <TouchableOpacity
              style={[styles.btn, { borderColor: theme.status.criticalBorder, backgroundColor: theme.status.criticalBg }]}
              onPress={() => onEndSession(state.iv_id)}
            >
              <Ionicons name="stop-circle-outline" size={13} color={theme.status.critical} />
              <Text style={[styles.btnTxt, { color: theme.status.critical }]}>End</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function Metric({ icon, value, color, theme }: { icon: string; value: string; color: string; theme: any }) {
  return (
    <View style={[styles.metricChip, { backgroundColor: theme.bg.input }]}>
      <Ionicons name={icon as any} size={11} color={color} />
      <Text style={[styles.metricVal, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md, borderWidth: 1, borderTopWidth: 3,
    padding: Spacing.md, gap: 7,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 2,
  },
  row1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roomPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm, gap: 3 },
  roomText: { fontSize: 11, fontWeight: '700' },
  ivId: { flex: 1, fontSize: 10 },
  alarmDot: { width: 8, height: 8, borderRadius: 4 },
  patientName: { fontSize: Typography.base, fontWeight: '700', lineHeight: 20 },
  row3: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  fluidName: { fontSize: 11, flex: 1 },
  volumeSection: { gap: 3 },
  volumeLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  volumeMl: { fontSize: Typography.md, fontWeight: '700' },
  volumePct: { fontSize: Typography.sm, fontWeight: '700' },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  bagOf: { fontSize: 10 },
  metricsRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  metricChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.sm, gap: 3 },
  metricVal: { fontSize: 10, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 6 },
  timestamp: { fontSize: 10, flex: 1 },
  btnRow: { flexDirection: 'row', gap: 5 },
  btn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, gap: 3 },
  btnTxt: { fontSize: 11, fontWeight: '600' },
});
