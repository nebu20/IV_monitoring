import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Typography, Spacing, Radius } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { API } from '../../constants/config';
import { TelemetryHistory } from '../../types';
import { useIVStore } from '../../store/ivStore';
import { StatusBadge } from '../../components/StatusBadge';
import { VolumeBar } from '../../components/VolumeBar';

export default function DetailsScreen() {
  const { ivId } = useLocalSearchParams<{ ivId: string }>();
  const { theme } = useTheme();
  const [history, setHistory] = useState<TelemetryHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (res.ok) setHistory(await res.json());
      else setError('Could not load IV history.');
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [ivId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.text.secondary }]}>Loading details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !history) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.status.critical} />
          <Text style={[styles.errorText, { color: theme.status.critical }]}>{error ?? 'IV not found'}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.accentMuted }]} onPress={fetchHistory}>
            <Text style={[styles.retryText, { color: theme.accent }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = history.metadata;
  const logs = history.telemetry_logs;
  const events = history.events;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>

      {/* ── Back nav bar ── */}
      <View style={[styles.navBar, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text.primary }]} numberOfLines={1}>
          {meta.patient_name}
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={fetchHistory} tintColor={theme.accent} />}
      >
        {/* Header card */}
        <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
          <View style={styles.headerTop}>
            <View>
              <Text style={[styles.patientName, { color: theme.text.primary }]}>{meta.patient_name}</Text>
              <Text style={[styles.roomBed, { color: theme.text.secondary }]}>{meta.room_bed}</Text>
            </View>
            {liveState && <StatusBadge status={liveState.flow_status} />}
          </View>
          <View style={styles.metaRow}>
            <MetaItem theme={theme} icon="water-outline" label="Fluid" value={meta.fluid_name} />
            <MetaItem theme={theme} icon="beaker-outline" label="Bag" value={`${meta.bag_size_ml} mL`} />
            <MetaItem theme={theme} icon="speedometer-outline" label="Rx" value={`${meta.prescribed_rate_gtt_min} gtt/min`} />
          </View>
          <MetaItem theme={theme} icon="hardware-chip-outline" label="Sensor" value={meta.sensor_id} />
          <MetaItem theme={theme} icon="key-outline" label="IV ID" value={meta.iv_id} />
        </View>

        {/* Live diagnostics */}
        {liveState && (
          <>
            <SectionTitle theme={theme} title="Live Diagnostics" icon="pulse-outline" />
            <View style={styles.diagGrid}>
              <DiagCard theme={theme} label="Raw Weight" value={`${liveState.raw_weight_grams.toFixed(1)} g`} icon="scale-outline" color={theme.accent} />
              <DiagCard theme={theme} label="Drip Rate" value={`${liveState.drip_rate_gtt_min.toFixed(1)} gtt/min`} icon="water-outline" color={theme.status.normal} />
              <DiagCard theme={theme} label="Volume" value={`${liveState.volume_ml.toFixed(0)} mL`} icon="beaker-outline" color={theme.status.advisory} />
              <DiagCard theme={theme} label="ETA" value={liveState.eta_string} icon="time-outline"
                color={liveState.eta_string === 'ETA Unavailable' ? theme.status.critical : theme.status.normal} />
            </View>
            <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
              <VolumeBar percentage={liveState.percentage} volumeMl={liveState.volume_ml} bagSizeMl={liveState.bag_size_ml} />
            </View>
            {(liveState.alarm_priority === 'CRITICAL' || liveState.alarm_priority === 'HIGH') && !liveState.alarm_acknowledged && (
              <TouchableOpacity
                style={[styles.ackBtn, { borderColor: theme.status.advisoryBorder, backgroundColor: theme.status.advisoryBg }]}
                onPress={() => acknowledgeAlarm(liveState.iv_id)}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.status.advisory} />
                <Text style={[styles.ackBtnText, { color: theme.status.advisory }]}>Acknowledge Current Alarm</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Telemetry history */}
        <SectionTitle theme={theme} title={`Telemetry History (last ${logs.length})`} icon="bar-chart-outline" />
        {logs.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.text.muted }]}>No telemetry logs yet.</Text>
        ) : (
          <View style={[styles.logTable, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
            <View style={[styles.logHeaderRow, { backgroundColor: theme.bg.input }]}>
              {['Time', 'Vol', '%', 'gtt/min', 'Status'].map((h, i) => (
                <Text key={h} style={[styles.logCell, styles.logHeader, { color: theme.text.muted, flex: i === 0 ? 1.4 : 1 }]}>{h}</Text>
              ))}
            </View>
            {logs.slice(0, 20).map((log, i) => (
              <View key={i} style={[styles.logRow, i % 2 === 0 && { backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                <Text style={[styles.logCell, { flex: 1.4, color: theme.text.secondary }]}>{format(new Date(log.timestamp), 'HH:mm:ss')}</Text>
                <Text style={[styles.logCell, { color: theme.text.secondary }]}>{log.volume_ml.toFixed(0)}</Text>
                <Text style={[styles.logCell, { color: theme.text.secondary }]}>{log.percentage.toFixed(0)}%</Text>
                <Text style={[styles.logCell, { color: theme.text.secondary }]}>{log.drip_rate_gtt_min.toFixed(1)}</Text>
                <Text style={[styles.logCell, { color: statusColor(log.flow_status as any, theme) }]}>{log.flow_status}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Event timeline */}
        <SectionTitle theme={theme} title="Event Timeline" icon="time-outline" />
        {events.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.text.muted }]}>No events recorded.</Text>
        ) : (
          <View style={styles.timeline}>
            {events.map((evt, i) => (
              <View key={i} style={styles.timelineItem}>
                <View style={styles.timelineLine}>
                  <View style={[styles.timelineDot, { backgroundColor: theme.accent }]} />
                  {i < events.length - 1 && <View style={[styles.timelineConnector, { backgroundColor: theme.border }]} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={[styles.evtType, { color: theme.text.primary }]}>{evt.event_type.replace('_', ' ')}</Text>
                  <Text style={[styles.evtTime, { color: theme.text.muted }]}>{format(new Date(evt.timestamp), 'MMM d, yyyy HH:mm')}</Text>
                  {evt.nurse_notes && <Text style={[styles.evtNotes, { color: theme.text.secondary }]}>{evt.nurse_notes}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ title, icon, theme }: { title: string; icon: string; theme: any }) {
  return (
    <View style={[styles.sectionRow, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon as any} size={15} color={theme.accent} />
      <Text style={[styles.sectionText, { color: theme.text.secondary }]}>{title}</Text>
    </View>
  );
}

function MetaItem({ icon, label, value, theme }: { icon: string; label: string; value: string; theme: any }) {
  return (
    <View style={styles.metaItemRow}>
      <Ionicons name={icon as any} size={13} color={theme.text.muted} />
      <Text style={[styles.metaLabel, { color: theme.text.muted }]}>{label}:</Text>
      <Text style={[styles.metaValue, { color: theme.text.primary }]}>{value}</Text>
    </View>
  );
}

function DiagCard({ label, value, icon, color, theme }: { label: string; value: string; icon: string; color: string; theme: any }) {
  return (
    <View style={[styles.diagCard, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={[styles.diagValue, { color: theme.text.primary }]}>{value}</Text>
      <Text style={[styles.diagLabel, { color: theme.text.muted }]}>{label}</Text>
    </View>
  );
}

function statusColor(status: string, theme: any): string {
  return ({
    NORMAL: theme.status.normal,
    ADVISORY: theme.status.advisory,
    CRITICAL: theme.status.critical,
    HIGH_PRIORITY: theme.status.high,
    ANOMALY: theme.status.anomaly,
  } as any)[status] ?? theme.text.muted;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: Typography.base },
  errorText: { fontSize: Typography.base, textAlign: 'center' },
  retryBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  retryText: { fontSize: Typography.base, fontWeight: '600' },

  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingRight: Spacing.md, minWidth: 90 },
  backText: { fontSize: Typography.sm, fontWeight: '600' },
  navTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },
  navSpacer: { minWidth: 90 },

  card: { borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1, gap: Spacing.sm },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  patientName: { fontSize: Typography.xl, fontWeight: '800' },
  roomBed: { fontSize: Typography.sm },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  metaItemRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaLabel: { fontSize: Typography.xs },
  metaValue: { fontSize: Typography.xs, fontWeight: '600' },

  diagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  diagCard: { flex: 1, minWidth: '45%', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, alignItems: 'center', gap: 4 },
  diagValue: { fontSize: Typography.md, fontWeight: '800', textAlign: 'center' },
  diagLabel: { fontSize: Typography.xs, textAlign: 'center' },

  ackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  ackBtnText: { fontSize: Typography.base, fontWeight: '600' },

  logTable: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  logHeaderRow: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  logRow: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  logCell: { flex: 1, fontSize: 11 },
  logHeader: { fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },

  timeline: { gap: 0 },
  timelineItem: { flexDirection: 'row', gap: Spacing.md },
  timelineLine: { alignItems: 'center', width: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  timelineConnector: { flex: 1, width: 2, marginTop: 4, marginBottom: -4 },
  timelineContent: { flex: 1, paddingBottom: Spacing.lg, gap: 2 },
  evtType: { fontSize: Typography.sm, fontWeight: '700', textTransform: 'capitalize' },
  evtTime: { fontSize: Typography.xs },
  evtNotes: { fontSize: Typography.xs, fontStyle: 'italic' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: 1, paddingBottom: Spacing.sm, marginTop: Spacing.sm },
  sectionText: { fontSize: Typography.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyText: { fontSize: Typography.sm, textAlign: 'center', paddingVertical: Spacing.lg },
});
