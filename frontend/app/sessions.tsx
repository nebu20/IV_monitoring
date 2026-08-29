/**
 * IV Session History Screen
 * ==========================
 * Shows completed/released IV sessions for audit.
 * Nurses see only their assigned beds.
 * Admins see all sessions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { BASE_URL } from '../constants/config';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Session {
  id: number;
  iv_id: string;
  patient_name: string;
  card_id?: string;
  room_bed: string;
  fluid_name: string;
  bag_size_ml: number;
  session_start?: string;
  session_end?: string;
  total_volume_delivered_ml?: number;
  released_by?: string;
  notes?: string;
}

export default function SessionHistoryScreen() {
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/iv/sessions`, {
        headers: { Authorization: `Bearer ${user?.token ?? ''}` },
      });
      if (res.ok) setSessions(await res.json());
    } catch { }
  }, []);

  useEffect(() => {
    fetchSessions().finally(() => setLoading(false));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSessions();
    setRefreshing(false);
  };

  const formatDuration = (start?: string, end?: string) => {
    if (!start || !end) return '—';
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>

      {/* Nav */}
      <View style={[styles.navBar, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text.primary }]}>Session History</Text>
        <View style={{ width: 90 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        >
          {sessions.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={44} color={theme.text.muted} />
              <Text style={[styles.emptyTitle, { color: theme.text.secondary }]}>No Completed Sessions</Text>
              <Text style={[styles.emptyText, { color: theme.text.muted }]}>
                Sessions appear here after a nurse clicks "End Session" on a bed card.
              </Text>
            </View>
          ) : (
            sessions.map((s) => (
              <View key={s.id} style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
                {/* Header */}
                <View style={styles.cardHeader}>
                  <View style={[styles.bedBadge, { backgroundColor: theme.accentMuted }]}>
                    <Ionicons name="bed-outline" size={12} color={theme.accent} />
                    <Text style={[styles.bedBadgeText, { color: theme.accent }]}>{s.room_bed}</Text>
                  </View>
                  <Text style={[styles.patientName, { color: theme.text.primary }]}>{s.patient_name}</Text>
                  {s.card_id && (
                    <Text style={[styles.cardId, { color: theme.text.muted }]}>{s.card_id}</Text>
                  )}
                </View>

                {/* Fluid + Volume delivered */}
                <View style={styles.statsRow}>
                  <StatChip theme={theme} icon="water-outline" label="Fluid" value={s.fluid_name} />
                  <StatChip theme={theme} icon="beaker-outline" label="Delivered"
                    value={s.total_volume_delivered_ml != null ? `${s.total_volume_delivered_ml} mL` : '—'}
                    color={theme.status.normal}
                  />
                  <StatChip theme={theme} icon="time-outline" label="Duration"
                    value={formatDuration(s.session_start, s.session_end)}
                  />
                </View>

                {/* Timestamps */}
                <View style={styles.timeRow}>
                  <Ionicons name="play-circle-outline" size={13} color={theme.status.normal} />
                  <Text style={[styles.timeText, { color: theme.text.secondary }]}>
                    Started: {s.session_start ? format(new Date(s.session_start), 'MMM d, HH:mm') : '—'}
                  </Text>
                </View>
                <View style={styles.timeRow}>
                  <Ionicons name="stop-circle-outline" size={13} color={theme.status.critical} />
                  <Text style={[styles.timeText, { color: theme.text.secondary }]}>
                    Ended: {s.session_end ? format(new Date(s.session_end), 'MMM d, HH:mm') : '—'}
                  </Text>
                </View>

                {/* Released by */}
                <View style={[styles.footer, { borderTopColor: theme.border }]}>
                  <Ionicons name="person-outline" size={12} color={theme.text.muted} />
                  <Text style={[styles.footerText, { color: theme.text.muted }]}>
                    Released by {s.released_by ?? '—'}
                  </Text>
                  {s.notes && (
                    <Text style={[styles.notes, { color: theme.text.secondary }]}>· {s.notes}</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatChip({ icon, label, value, color, theme }: { icon: string; label: string; value: string; color?: string; theme: any }) {
  return (
    <View style={[chipStyles.chip, { backgroundColor: theme.bg.input }]}>
      <Ionicons name={icon as any} size={12} color={color ?? theme.text.muted} />
      <View>
        <Text style={[chipStyles.label, { color: theme.text.muted }]}>{label}</Text>
        <Text style={[chipStyles.value, { color: color ?? theme.text.primary }]}>{value}</Text>
      </View>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: Spacing.sm, borderRadius: Radius.sm, flex: 1 },
  label: { fontSize: 9, textTransform: 'uppercase' },
  value: { fontSize: 11, fontWeight: '700' },
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 90 },
  backText: { fontSize: Typography.sm, fontWeight: '600' },
  navTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },
  empty: { alignItems: 'center', gap: Spacing.md, marginTop: 60 },
  emptyTitle: { fontSize: Typography.lg, fontWeight: '700' },
  emptyText: { fontSize: Typography.sm, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  card: { borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1, gap: Spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  bedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  bedBadgeText: { fontSize: 11, fontWeight: '700' },
  patientName: { fontSize: Typography.base, fontWeight: '700', flex: 1 },
  cardId: { fontSize: Typography.xs },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timeText: { fontSize: Typography.xs },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: Spacing.sm, borderTopWidth: 1, marginTop: 2 },
  footerText: { fontSize: Typography.xs },
  notes: { fontSize: Typography.xs, flex: 1 },
});
