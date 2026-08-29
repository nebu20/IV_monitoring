import React, { useCallback, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TextInput, Alert,
  TouchableOpacity, RefreshControl, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIVStore, SortMode, FilterMode } from '../store/ivStore';
import { useAuthStore } from '../store/authStore';
import { PatientCard } from '../components/PatientCard';
import { SummaryBar } from '../components/SummaryBar';
import { AlarmBanner } from '../components/AlarmBanner';
import { NewBagModal } from '../components/NewBagModal';
import { EndSessionModal } from '../components/EndSessionModal';
import { Typography, Spacing, Radius } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { TelemetryState } from '../types';
import { API, BASE_URL } from '../constants/config';

const SORT_OPTIONS: { key: SortMode; label: string; icon: string }[] = [
  { key: 'urgency', label: 'Urgency', icon: 'alert-circle-outline' },
  { key: 'eta',     label: 'ETA',     icon: 'time-outline' },
  { key: 'room',    label: 'Room',    icon: 'bed-outline' },
];

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'no_flow',    label: 'No Flow' },
  { key: 'low_volume', label: 'Low Volume' },
  { key: 'offline',    label: 'Offline' },
];

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const { user, isAdmin } = useAuthStore();
  const numColumns = width < 600 ? 1 : width < 1100 ? 2 : 3;

  const {
    wsConnected, sortMode, filterMode, searchQuery,
    newBagModalVisible, newBagIvId,
    setSortMode, setFilterMode, setSearchQuery,
    getSortedFiltered, getSummaryBar, hasUnacknowledgedCritical,
    acknowledgeAlarm, confirmNewBag, dismissNewBagModal,
  } = useIVStore();

  const [refreshing, setRefreshing] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [endSessionVisible, setEndSessionVisible] = useState(false);
  const [endSessionTarget, setEndSessionTarget] = useState<{ ivId: string; patientName: string } | null>(null);

  const allItems = getSortedFiltered();
  const hasAlarm = hasUnacknowledgedCritical();

  // RBAC filter — nurse sees only assigned beds
  const filteredItems = useMemo(() => {
    if (!user) return [];
    if (user.role === 'Admin' || user.role === 'Superadmin') return allItems;
    if (!user.assigned_beds || user.assigned_beds.length === 0) return allItems;
    return allItems.filter((s) => user.assigned_beds.includes(s.room_bed));
  }, [allItems, user]);

  // Summary counts based on filtered items only
  const filteredSummary = useMemo(() => {
    const now = Date.now();
    const STALE_MS = 60_000;
    let critical = 0, attention = 0, normal = 0, stale = 0;
    filteredItems.forEach((s) => {
      const isStale = now - new Date(s.last_update).getTime() > STALE_MS;
      if (isStale) stale++;
      else if (s.alarm_priority === 'CRITICAL') critical++;
      else if (s.alarm_priority === 'HIGH' || s.alarm_priority === 'LOW') attention++;
      else normal++;
    });
    return { critical, attention, normal, stale };
  }, [filteredItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(API.TELEMETRY);
      if (res.ok) {
        const data: TelemetryState[] = await res.json();
        const map: Record<string, TelemetryState> = {};
        data.forEach((s) => { map[s.sensor_id] = s; });
        useIVStore.setState({ ivMap: map });
      }
    } catch { }
    setRefreshing(false);
  }, []);

  // End Session — opens confirmation modal (web-compatible, no Alert)
  const handleEndSession = useCallback((ivId: string, patientName: string) => {
    setEndSessionTarget({ ivId, patientName });
    setEndSessionVisible(true);
  }, []);

  const confirmEndSession = async (ivId: string) => {
    try {
      const token = user?.token ?? '';
      const res = await fetch(`${BASE_URL}/api/iv/end-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ iv_id: ivId }),
      });
      if (res.ok) {
        // Remove card immediately from local state
        useIVStore.setState((state) => {
          const newMap = { ...state.ivMap };
          const sensorId = Object.keys(newMap).find((k) => newMap[k].iv_id === ivId);
          if (sensorId) delete newMap[sensorId];
          return { ivMap: newMap };
        });
        setEndSessionVisible(false);
        setEndSessionTarget(null);
      } else {
        const e = await res.json();
        setEndSessionVisible(false);
        // Use window.alert for web since Alert doesn't work
        if (typeof window !== 'undefined') {
          window.alert(`Error: ${e.detail ?? 'Could not end session'}`);
        }
      }
    } catch {
      setEndSessionVisible(false);
      if (typeof window !== 'undefined') {
        window.alert('Network error. Check your connection.');
      }
    }
  };

  // Auth guard
  if (!user) return null;

  const renderItem = ({ item }: { item: TelemetryState }) => (
    <View style={{ flex: 1, margin: Spacing.sm / 2 }}>
      <PatientCard
        state={item}
        onAcknowledge={acknowledgeAlarm}
        onDetails={(ivId) => router.push(`/details/${ivId}`)}
        onEndSession={
          user.role === 'Nurse' || user.role === 'Admin' || user.role === 'Superadmin'
            ? (ivId) => handleEndSession(ivId, item.patient_name)
            : undefined
        }
      />
    </View>
  );

  const isNurseWithNoAssignedBeds =
    user.role === 'Nurse' &&
    (!user.assigned_beds || user.assigned_beds.length === 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>
      <AlarmBanner
        visible={hasAlarm}
        criticalCount={filteredSummary.critical}
        onPress={() => setSortMode('urgency')}
      />

      {!wsConnected && (
        <View style={[styles.offlineStrip, { backgroundColor: theme.bg.secondary }]}>
          <Ionicons name="wifi-outline" size={12} color={theme.text.muted} />
          <Text style={[styles.offlineText, { color: theme.text.muted }]}>Connecting to live feed…</Text>
        </View>
      )}

      {/* Nurse assigned beds strip */}
      {user.role === 'Nurse' && user.assigned_beds && user.assigned_beds.length > 0 && (
        <View style={[styles.nurseStrip, { backgroundColor: theme.accentMuted }]}>
          <Ionicons name="bed-outline" size={12} color={theme.accent} />
          <Text style={[styles.nurseStripText, { color: theme.accent }]}>
            Your beds: {user.assigned_beds.join(' · ')}
          </Text>
        </View>
      )}

      <View style={styles.container}>
        <SummaryBar {...filteredSummary} />

        {/* Controls row */}
        <View style={styles.controlsRow}>
          <View style={styles.sortGroup}>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortBtn, {
                  borderColor: sortMode === opt.key ? theme.accent : theme.border,
                  backgroundColor: sortMode === opt.key ? theme.accentMuted : theme.bg.secondary,
                }]}
                onPress={() => setSortMode(opt.key)}
              >
                <Ionicons name={opt.icon as any} size={12} color={sortMode === opt.key ? theme.accent : theme.text.secondary} />
                <Text style={[styles.sortBtnText, { color: sortMode === opt.key ? theme.accent : theme.text.secondary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 5 }}>
            {/* Nurse buttons */}
            {user.role === 'Nurse' && (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}
                  onPress={() => router.push('/start-iv')}
                >
                  <Ionicons name="play-circle-outline" size={14} color={theme.accent} />
                  <Text style={[styles.actionBtnText, { color: theme.accent }]}>Start IV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.bg.secondary }]}
                  onPress={() => router.push('/sessions')}
                >
                  <Ionicons name="time-outline" size={14} color={theme.text.secondary} />
                  <Text style={[styles.actionBtnText, { color: theme.text.secondary }]}>History</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Admin buttons */}
            {(user.role === 'Admin' || user.role === 'Superadmin') && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}
                onPress={() => router.push('/register')}
              >
                <Ionicons name="add-circle-outline" size={14} color={theme.accent} />
                <Text style={[styles.actionBtnText, { color: theme.accent }]}>Register IV</Text>
              </TouchableOpacity>
            )}
            {isAdmin() && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: theme.status.advisory, backgroundColor: theme.status.advisoryBg }]}
                onPress={() => router.push('/admin')}
              >
                <Ionicons name="shield-checkmark-outline" size={14} color={theme.status.advisory} />
                <Text style={[styles.actionBtnText, { color: theme.status.advisory }]}>Admin</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filter pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTER_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.filterPill, {
                borderColor: filterMode === opt.key && !searchActive ? theme.accent : theme.border,
                backgroundColor: filterMode === opt.key && !searchActive ? theme.accentMuted : theme.bg.secondary,
              }]}
              onPress={() => { setFilterMode(opt.key); setSearchActive(false); }}
            >
              <Text style={[styles.filterPillText, { color: filterMode === opt.key && !searchActive ? theme.accent : theme.text.secondary }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.filterPill, {
              borderColor: searchActive ? theme.accent : theme.border,
              backgroundColor: searchActive ? theme.accentMuted : theme.bg.secondary,
            }]}
            onPress={() => { setSearchActive(true); setFilterMode('search'); }}
          >
            <Ionicons name="search-outline" size={11} color={searchActive ? theme.accent : theme.text.secondary} />
            <Text style={[styles.filterPillText, { color: searchActive ? theme.accent : theme.text.secondary }]}>Search</Text>
          </TouchableOpacity>
        </ScrollView>

        {searchActive && (
          <TextInput
            style={[styles.searchInput, { backgroundColor: theme.bg.input, borderColor: theme.border, color: theme.text.primary }]}
            placeholder="Patient name, room, or IV ID…"
            placeholderTextColor={theme.text.muted}
            value={searchQuery}
            onChangeText={(q) => { setSearchQuery(q); setFilterMode('search'); }}
            autoFocus
          />
        )}

        <FlatList
          key={`grid-${numColumns}`}
          data={filteredItems}
          keyExtractor={(item) => item.sensor_id}
          renderItem={renderItem}
          numColumns={numColumns}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
          columnWrapperStyle={numColumns > 1 ? { gap: 0 } : undefined}
          contentContainerStyle={[styles.listContent, filteredItems.length === 0 && styles.listEmpty]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="pulse-outline" size={40} color={theme.text.muted} />
              <Text style={[styles.emptyTitle, { color: theme.text.secondary }]}>No IV Lines</Text>
              <Text style={[styles.emptySubtitle, { color: theme.text.muted }]}>
                {isNurseWithNoAssignedBeds
                  ? 'No beds assigned to your account. Contact the Admin.'
                  : filterMode !== 'all'
                  ? 'No lines match the current filter.'
                  : user.role === 'Nurse'
                  ? 'Send a telemetry reading via Postman to see your beds.'
                  : 'Register an IV line or wait for the simulator to start.'}
              </Text>
            </View>
          }
        />
      </View>

      <NewBagModal visible={newBagModalVisible} ivId={newBagIvId} onConfirm={confirmNewBag} onDismiss={dismissNewBagModal} />

      <EndSessionModal
        visible={endSessionVisible}
        patientName={endSessionTarget?.patientName ?? ''}
        ivId={endSessionTarget?.ivId ?? ''}
        onConfirm={confirmEndSession}
        onCancel={() => { setEndSessionVisible(false); setEndSessionTarget(null); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  offlineStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 3 },
  offlineText: { fontSize: 11 },
  nurseStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  nurseStripText: { fontSize: 11, fontWeight: '600' },
  container: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm, gap: Spacing.sm },
  sortGroup: { flexDirection: 'row', gap: 5 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.sm, borderWidth: 1, gap: 3 },
  sortBtnText: { fontSize: 11, fontWeight: '600' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.sm, borderWidth: 1, gap: 4 },
  actionBtnText: { fontSize: 11, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 6, paddingBottom: Spacing.sm, alignItems: 'center' },
  filterPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1, gap: 3 },
  filterPillText: { fontSize: 11, fontWeight: '600' },
  searchInput: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: 7, fontSize: Typography.sm, marginBottom: Spacing.sm },
  listContent: { paddingBottom: Spacing['3xl'] },
  listEmpty: { flex: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', gap: Spacing.sm, marginTop: 60 },
  emptyTitle: { fontSize: Typography.lg, fontWeight: '700' },
  emptySubtitle: { fontSize: Typography.sm, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
