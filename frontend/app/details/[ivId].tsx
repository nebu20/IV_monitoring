/**
 * IV Details Screen
 * =================
 * Engineering / diagnostic view for a single IV line.
 * Shows raw sensor values, moving-average drip rate, telemetry history,
 * and event timeline.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Colors, Typography, Spacing, Radius } from '../../constants/theme';
import { API } from '../../constants/config';
import { TelemetryHistory, TelemetryState } from '../../types';
import { useIVStore } from '../../store/ivStore';
import { StatusBadge } from '../../components/StatusBadge';
import { VolumeBar } from '../../components/VolumeBar';

export default function DetailsScreen() {
  const { ivId } = useLocalSearchParams<{ ivId: string }>();
  const [history, setHistory] = useState<TelemetryHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live state from store
  const liveState = useIVStore((s) =>
    Object.values(s.ivMap).find((iv) => iv.iv_id === ivId)
  );
  const acknowledgeAlarm = useIVStore((s) => s.acknowledgeAlarm);

  const fetchHistory = useCallback(async () => {
    if (!ivId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API.HISTORY(ivId));
      if (res.ok) {
        setHistory(await res.json());
      } else {
        setError('Could not load IV history.');
      }
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [ivId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !history) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.status.critical} />
          <Text style={styles.errorText}>{error ?? 'IV not found'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchHistory}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = history.metadata;
  const logs = history.telemetry_logs;
  const events = history.events;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={fetchHistory} tintColor={Colors.accent} />
        }
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.patientName}>{meta.patient_name}</Text>
              <Text style={styles.roomBed}>{meta.room_bed}</Text>
            </View>
            {liveState && (
              <StatusBadge status={liveState.flow_status} />
            )}
          </View>

          <View style={styles.metaRow}>
            <MetaItem icon="water-outline" label="Fluid" value={meta.fluid_name} />
            <MetaItem icon="beaker-outline" label="Bag" value={`${meta.bag_size_ml} mL`} />
            <MetaItem icon="speedometer-outline" label="Rx Rate" value={`${meta.prescribed_rate_gtt_min} gtt/min`} />
          </View>

          <MetaItem icon="hardware-chip-outline" label="Sensor" value={meta.sensor_id} />
          <MetaItem icon="key-outline" label="IV ID" value={meta.iv_id} />
        </View>

        {/* Live diagnostics */}
        {liveState && (
          <>
            <SectionTitle title="Live Diagnostics" icon="pulse-outline" />
            <View style={styles.diagGrid}>
              <DiagCard
                label="Raw Weight"
                value={`${liveState.raw_weight_grams.toFixed(1)} g`}
                icon="scale-outline"
                color={Colors.accent}
              />
              <DiagCard
                label="Smoothed Drip Rate"
                value={`${liveState.drip_rate_gtt_min.toFixed(1)} gtt/min`}
                icon="water-outline"
                color={Colors.status.normal}
              />
              <DiagCard
                label="Volume Remaining"
                value={`${liveState.volume_ml.toFixed(0)} mL`}
                icon="beaker-outline"
                color={Colors.status.advisory}
              />
              <DiagCard
                label="ETA"
                value={liveState.eta_string}
                icon="time-outline"
                color={liveState.eta_string === 'ETA Unavailable' ? Colors.status.critical : Colors.status.normal}
              />
            </View>
            <View style={styles.volumeBarCard}>
              <VolumeBar
                percentage={liveState.percentage}
                volumeMl={liveState.volume_ml}
                bagSizeMl={liveState.bag_size_ml}
              />
            </View>

            {/* Acknowledge if alarm active */}
            {(liveState.alarm_priority === 'CRITICAL' || liveState.alarm_priority === 'HIGH') &&
              !liveState.alarm_acknowledged && (
                <TouchableOpacity
                  style={styles.ackBtn}
                  onPress={() => acknowledgeAlarm(liveState.iv_id)}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.status.advisory} />
                  <Text style={styles.ackBtnText}>Acknowledge Current Alarm</Text>
                </TouchableOpacity>
              )}
          </>
        )}

        {/* Telemetry history */}
        <SectionTitle title={`Telemetry History (last ${logs.length})`} icon="bar-chart-outline" />
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>No telemetry logs yet.</Text>
        ) : (
          <View style={styles.logTable}>
            <View style={styles.logHeaderRow}>
              <Text style={[styles.logCell, styles.logHeader, { flex: 1.4 }]}>Time</Text>
              <Text style={[styles.logCell, styles.logHeader]}>Vol</Text>
              <Text style={[styles.logCell, styles.logHeader]}>%</Text>
              <Text style={[styles.logCell, styles.logHeader]}>gtt/min</Text>
              <Text style={[styles.logCell, styles.logHeader]}>Status</Text>
            </View>
            {logs.slice(0, 20).map((log, i) => (
              <View
                key={i}
                style={[styles.logRow, i % 2 === 0 && styles.logRowAlt]}
              >
                <Text style={[styles.logCell, { flex: 1.4 }]}>
                  {format(new Date(log.timestamp), 'HH:mm:ss')}
                </Text>
                <Text style={styles.logCell}>{log.volume_ml.toFixed(0)}</Text>
                <Text style={styles.logCell}>{log.percentage.toFixed(0)}%</Text>
                <Text style={styles.logCell}>{log.drip_rate_gtt_min.toFixed(1)}</Text>
                <Text style={[styles.logCell, { color: _statusColor(log.flow_status as any) }]}>
                  {log.flow_status}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Event timeline */}
        <SectionTitle title="Event Timeline" icon="time-outline" />
        {events.length === 0 ? (
          <Text style={styles.emptyText}>No events recorded.</Text>
        ) : (
          <View style={styles.timeline}>
            {events.map((evt, i) => (
              <View key={i} style={styles.timelineItem}>
                <View style={styles.timelineLine}>
                  <View style={styles.timelineDot} />
                  {i < events.length - 1 && <View style={styles.timelineConnector} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={styles.evtType}>{evt.event_type.replace('_', ' ')}</Text>
                  <Text style={styles.evtTime}>
                    {format(new Date(evt.timestamp), 'MMM d, yyyy HH:mm')}
                  </Text>
                  {evt.nurse_notes && (
                    <Text style={styles.evtNotes}>{evt.nurse_notes}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={stStyles.row}>
      <Ionicons name={icon as any} size={15} color={Colors.accent} />
      <Text style={stStyles.text}>{title}</Text>
    </View>
  );
}

function MetaItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={miStyles.row}>
      <Ionicons name={icon as any} size={13} color={Colors.text.muted} />
      <Text style={miStyles.label}>{label}:</Text>
      <Text style={miStyles.value}>{value}</Text>
    </View>
  );
}

function DiagCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <View style={dcStyles.card}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={dcStyles.value}>{value}</Text>
      <Text style={dcStyles.label}>{label}</Text>
    </View>
  );
}

function _statusColor(status: string): string {
  const map: Record<string, string> = {
    NORMAL: Colors.status.normal,
    ADVISORY: Colors.status.advisory,
    CRITICAL: Colors.status.critical,
    HIGH_PRIORITY: Colors.status.high,
    ANOMALY: Colors.status.anomaly,
  };
  return map[status] ?? Colors.text.muted;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg.primary },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { color: Colors.text.secondary, fontSize: Typography.base },
  errorText: { color: Colors.status.critical, fontSize: Typography.base, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentMuted,
  },
  retryText: { color: Colors.accent, fontSize: Typography.base, fontWeight: '600' },

  headerCard: {
    backgroundColor: Colors.bg.card,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  patientName: {
    color: Colors.text.primary,
    fontSize: Typography.xl,
    fontWeight: '800',
  },
  roomBed: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },

  diagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  volumeBarCard: {
    backgroundColor: Colors.bg.card,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.status.advisoryBorder,
    backgroundColor: Colors.status.advisoryBg,
  },
  ackBtnText: {
    color: Colors.status.advisory,
    fontSize: Typography.base,
    fontWeight: '600',
  },

  logTable: {
    backgroundColor: Colors.bg.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  logHeaderRow: {
    flexDirection: 'row',
    backgroundColor: Colors.bg.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  logRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  logRowAlt: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  logCell: {
    flex: 1,
    color: Colors.text.secondary,
    fontSize: 11,
  },
  logHeader: {
    color: Colors.text.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    fontSize: 10,
  },

  timeline: { gap: 0 },
  timelineItem: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  timelineLine: {
    alignItems: 'center',
    width: 16,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.accent,
    marginTop: 4,
  },
  timelineConnector: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.border,
    marginTop: 4,
    marginBottom: -4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: Spacing.lg,
    gap: 2,
  },
  evtType: {
    color: Colors.text.primary,
    fontSize: Typography.sm,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  evtTime: {
    color: Colors.text.muted,
    fontSize: Typography.xs,
  },
  evtNotes: {
    color: Colors.text.secondary,
    fontSize: Typography.xs,
    fontStyle: 'italic',
  },
  emptyText: {
    color: Colors.text.muted,
    fontSize: Typography.sm,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
});

const stStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  text: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

const miStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { color: Colors.text.muted, fontSize: Typography.xs },
  value: { color: Colors.text.primary, fontSize: Typography.xs, fontWeight: '600' },
});

const dcStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.bg.card,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 4,
  },
  value: {
    color: Colors.text.primary,
    fontSize: Typography.md,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    color: Colors.text.muted,
    fontSize: Typography.xs,
    textAlign: 'center',
  },
});
