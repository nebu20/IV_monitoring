/**
 * Medication Reminders Screen
 * ============================
 * Shows due/overdue doses and active medication schedules.
 * Nurses can acknowledge reminders and record administration events.
 *
 * Polling is managed by the medication store so the token is always
 * read from state — no stale-closure problem on re-login.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { useMedicationStore } from '../store/medicationStore';
import { MedicationCard } from '../components/MedicationCard';
import { Typography, Spacing, Radius } from '../constants/theme';
import { DueDose, DueStatus } from '../types';

export default function MedicationsScreen() {
  const { theme } = useTheme();
  const { user, logout } = useAuthStore();
  const {
    dueDoses, schedules, fetchError, authError,
    fetchDueDoses, fetchSchedules, startPolling, stopPolling, setToken,
    administerDose, acknowledgeDose, ensureDose,
  } = useMedicationStore();

  const [refreshing, setRefreshing] = useState(false);
  const token = user?.token ?? '';

  useEffect(() => {
    if (!token) return;
    setToken(token);           // keep store token current before starting poll
    fetchSchedules(token);
    startPolling(token);
    return () => stopPolling();
  }, [token]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchDueDoses(token), fetchSchedules(token)]);
    setRefreshing(false);
  }, [token]);

  const overdueCount  = dueDoses.filter(d => d.status === 'OVERDUE').length;
  const dueCount      = dueDoses.filter(d => d.status === 'DUE').length;
  const upcomingCount = dueDoses.filter(d => d.status === 'UPCOMING').length;
  const completedCount = dueDoses.filter(d =>
    ['GIVEN', 'DELAYED', 'REFUSED', 'NOT_GIVEN'].includes(d.status)
  ).length;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.bg.primary }]}
      edges={['bottom', 'left', 'right']}
    >
      {/* Nav */}
      <View style={[styles.navBar, {
        backgroundColor: theme.bg.secondary, borderBottomColor: theme.border,
      }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text.primary }]}>
          Medication Reminders
        </Text>
        <View style={{ width: 90 }} />
      </View>

      {/* Auth error banner — session expired / token invalidated */}
      {authError && (
        <View style={[styles.authBanner, { backgroundColor: theme.status.criticalBg, borderBottomColor: theme.status.criticalBorder }]}>
          <Ionicons name="alert-circle-outline" size={15} color={theme.status.critical} />
          <Text style={[styles.authBannerText, { color: theme.status.critical }]}>
            Your session has expired. Please log in again.
          </Text>
          <TouchableOpacity
            onPress={async () => { await logout(); router.replace('/login'); }}
          >
            <Text style={[styles.authBannerAction, { color: theme.status.critical }]}>
              Log In
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Non-auth fetch error strip */}
      {fetchError != null && !authError && (
        <View style={[styles.errorStrip, {
          backgroundColor: theme.status.advisoryBg, borderBottomColor: theme.status.advisoryBorder,
        }]}>
          <Ionicons name="warning-outline" size={13} color={theme.status.advisory} />
          <Text style={[styles.errorStripText, { color: theme.status.advisory }]}>
            {fetchError}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
      >
        {/* Summary bar */}
        <View style={[styles.summaryBar, {
          backgroundColor: theme.bg.secondary, borderColor: theme.border,
        }]}>
          <SummaryChip label="Overdue"  count={overdueCount}  color={theme.status.critical} theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SummaryChip label="Due"      count={dueCount}      color={theme.status.advisory} theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SummaryChip label="Upcoming" count={upcomingCount} color={theme.status.normal}   theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SummaryChip label="Done"     count={completedCount} color={theme.text.muted}     theme={theme} />
        </View>

        {dueDoses.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="medkit-outline" size={40} color={theme.text.muted} />
            <Text style={[styles.emptyTitle, { color: theme.text.secondary }]}>
              No Due Doses
            </Text>
            <Text style={[styles.emptyText, { color: theme.text.muted }]}>
              All medication reminders are up to date.
            </Text>
          </View>
        ) : (
          <View style={styles.doseList}>
            {dueDoses.map((dose, i) => (
              <MedicationCard
                key={`${dose.schedule_id}-${dose.scheduled_datetime}-${i}`}
                dose={dose}
                onAdminister={(doseId, status, reason, notes) =>
                  administerDose(token, doseId, status, reason, notes)
                }
                onAcknowledge={(doseId) => acknowledgeDose(token, doseId)}
                /* Pass the UTC datetime for the ensure endpoint so the
                   backend can match the stored scheduled_datetime exactly */
                onEnsureDose={(schedId, utcDt) =>
                  ensureDose(token, schedId, utcDt)
                }
              />
            ))}
          </View>
        )}

        {/* Active schedules */}
        {schedules.length > 0 && (
          <View style={styles.schedulesSection}>
            <View style={[styles.sectionHeader, { borderBottomColor: theme.border }]}>
              <Ionicons name="list-outline" size={15} color={theme.accent} />
              <Text style={[styles.sectionText, { color: theme.text.secondary }]}>
                Active Schedules ({schedules.length})
              </Text>
            </View>
            {schedules.map((sched) => (
              <View
                key={sched.id}
                style={[styles.schedCard, {
                  backgroundColor: theme.bg.card, borderColor: theme.border,
                }]}
              >
                <View style={styles.schedRow}>
                  <View style={[styles.medPill, { backgroundColor: theme.accentMuted }]}>
                    <Ionicons name="medical-outline" size={11} color={theme.accent} />
                    <Text style={[styles.medPillText, { color: theme.accent }]}>
                      {sched.route}
                    </Text>
                  </View>
                  <Text
                    style={[styles.schedName, { color: theme.text.primary }]}
                    numberOfLines={1}
                  >
                    {sched.medication_name} — {sched.dose}
                  </Text>
                </View>
                <View style={styles.schedInfoRow}>
                  <Text style={[styles.schedInfo, { color: theme.text.secondary }]}>
                    {sched.patient_name ?? sched.card_id} · {sched.room_bed ?? 'No bed'}
                  </Text>
                  <Text style={[styles.schedTimes, { color: theme.text.muted }]}>
                    {sched.scheduled_times.join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.schedFreq, { color: theme.text.muted }]}>
                  {sched.frequency}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryChip({
  label, count, color, theme,
}: { label: string; count: number; color: string; theme: any }) {
  return (
    <View style={styles.chip}>
      <Text style={[styles.chipCount, { color }]}>{count}</Text>
      <Text style={[styles.chipLabel, { color: theme.text.secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  navBar:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 90 },
  backText:  { fontSize: Typography.sm, fontWeight: '600' },
  navTitle:  { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },

  authBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  authBannerText:   { flex: 1, fontSize: Typography.sm, fontWeight: '600' },
  authBannerAction: { fontSize: Typography.sm, fontWeight: '800', textDecorationLine: 'underline' },

  errorStrip:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.lg, paddingVertical: 4, borderBottomWidth: 1 },
  errorStripText: { fontSize: Typography.xs, flex: 1 },

  scroll:   { flex: 1 },
  content:  { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },

  summaryBar: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, borderWidth: 1 },
  chip:       { flex: 1, alignItems: 'center', gap: 2 },
  chipCount:  { fontSize: Typography['2xl'], fontWeight: '800' },
  chipLabel:  { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider:    { width: 1, height: 32 },

  emptyState: { alignItems: 'center', gap: Spacing.sm, marginTop: 60 },
  emptyTitle: { fontSize: Typography.lg, fontWeight: '700' },
  emptyText:  { fontSize: Typography.sm, textAlign: 'center', maxWidth: 280 },

  doseList:         { gap: Spacing.sm },
  schedulesSection: { gap: Spacing.sm, marginTop: Spacing.md },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: 1, paddingBottom: Spacing.sm },
  sectionText:      { fontSize: Typography.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  schedCard:    { borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, gap: 4 },
  schedRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  medPill:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm, gap: 3 },
  medPillText:  { fontSize: 10, fontWeight: '700' },
  schedName:    { fontSize: Typography.base, fontWeight: '700', flex: 1 },
  schedInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  schedInfo:    { fontSize: 11, flex: 1 },
  schedTimes:   { fontSize: 11, fontWeight: '600' },
  schedFreq:    { fontSize: 10, textTransform: 'uppercase' },
});
