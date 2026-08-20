/**
 * Central Dashboard Screen
 * ========================
 * Responsive 2-column grid (3-column on wide screens).
 * All controls visible, cards compact enough to see 4-6 at once.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIVStore, SortMode, FilterMode } from '../store/ivStore';
import { PatientCard } from '../components/PatientCard';
import { SummaryBar } from '../components/SummaryBar';
import { AlarmBanner } from '../components/AlarmBanner';
import { NewBagModal } from '../components/NewBagModal';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { TelemetryState } from '../types';
import { API } from '../constants/config';

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

  // Responsive columns: 1 on mobile, 2 on tablet/web, 3 on wide desktop
  const numColumns = width < 600 ? 1 : width < 1100 ? 2 : 3;

  const {
    wsConnected,
    sortMode,
    filterMode,
    searchQuery,
    newBagModalVisible,
    newBagIvId,
    setSortMode,
    setFilterMode,
    setSearchQuery,
    getSortedFiltered,
    getSummaryBar,
    hasUnacknowledgedCritical,
    acknowledgeAlarm,
    confirmNewBag,
    dismissNewBagModal,
  } = useIVStore();

  const [refreshing, setRefreshing] = useState(false);
  const [searchActive, setSearchActive] = useState(false);

  const items = getSortedFiltered();
  const summary = getSummaryBar();
  const hasAlarm = hasUnacknowledgedCritical();

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
    } catch { /* fail silently */ }
    setRefreshing(false);
  }, []);

  const renderItem = ({ item }: { item: TelemetryState }) => (
    <View style={{ flex: 1, margin: Spacing.sm / 2 }}>
      <PatientCard
        state={item}
        onAcknowledge={acknowledgeAlarm}
        onDetails={(ivId) => router.push(`/details/${ivId}`)}
      />
    </View>
  );

  // FlatList key changes when numColumns changes to force re-render
  const listKey = `grid-${numColumns}`;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>

      {/* Global alarm banner */}
      <AlarmBanner
        visible={hasAlarm}
        criticalCount={summary.critical}
        onPress={() => setSortMode('urgency')}
      />

      {/* Connection status */}
      {!wsConnected && (
        <View style={styles.offlineStrip}>
          <Ionicons name="wifi-outline" size={12} color={Colors.text.muted} />
          <Text style={styles.offlineText}>Connecting to live feed…</Text>
        </View>
      )}

      <View style={styles.container}>

        {/* Summary bar */}
        <SummaryBar {...summary} />

        {/* Controls row */}
        <View style={styles.controlsRow}>
          {/* Sort buttons */}
          <View style={styles.sortGroup}>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortBtn, sortMode === opt.key && styles.sortBtnActive]}
                onPress={() => setSortMode(opt.key)}
              >
                <Ionicons
                  name={opt.icon as any}
                  size={12}
                  color={sortMode === opt.key ? Colors.accent : Colors.text.secondary}
                />
                <Text style={[styles.sortBtnText, sortMode === opt.key && { color: Colors.accent }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Register IV button */}
          <TouchableOpacity
            style={styles.registerBtn}
            onPress={() => router.push('/register')}
          >
            <Ionicons name="add-circle-outline" size={14} color={Colors.accent} />
            <Text style={styles.registerBtnText}>Register IV</Text>
          </TouchableOpacity>
        </View>

        {/* Filter pills + search */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTER_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.filterPill, filterMode === opt.key && !searchActive && styles.filterPillActive]}
              onPress={() => {
                setFilterMode(opt.key);
                setSearchActive(false);
              }}
            >
              <Text style={[styles.filterPillText, filterMode === opt.key && !searchActive && { color: Colors.accent }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.filterPill, searchActive && styles.filterPillActive]}
            onPress={() => {
              setSearchActive(true);
              setFilterMode('search');
            }}
          >
            <Ionicons name="search-outline" size={11} color={searchActive ? Colors.accent : Colors.text.secondary} />
            <Text style={[styles.filterPillText, searchActive && { color: Colors.accent }]}>Search</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Search input */}
        {searchActive && (
          <TextInput
            style={styles.searchInput}
            placeholder="Patient name, room, or IV ID…"
            placeholderTextColor={Colors.text.muted}
            value={searchQuery}
            onChangeText={(q) => { setSearchQuery(q); setFilterMode('search'); }}
            autoFocus
          />
        )}

        {/* Grid */}
        <FlatList
          key={listKey}
          data={items}
          keyExtractor={(item) => item.sensor_id}
          renderItem={renderItem}
          numColumns={numColumns}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
          columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
          contentContainerStyle={[
            styles.listContent,
            items.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="pulse-outline" size={40} color={Colors.text.muted} />
              <Text style={styles.emptyTitle}>No IV Lines</Text>
              <Text style={styles.emptySubtitle}>
                {filterMode !== 'all'
                  ? 'No lines match the current filter.'
                  : 'Register an IV line or wait for the simulator to start.'}
              </Text>
            </View>
          }
        />
      </View>

      {/* New bag modal */}
      <NewBagModal
        visible={newBagModalVisible}
        ivId={newBagIvId}
        onConfirm={confirmNewBag}
        onDismiss={dismissNewBagModal}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg.primary,
  },
  offlineStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.bg.secondary,
    paddingVertical: 3,
  },
  offlineText: {
    color: Colors.text.muted,
    fontSize: 11,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },

  // Controls
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  sortGroup: {
    flexDirection: 'row',
    gap: 5,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 3,
    backgroundColor: Colors.bg.secondary,
  },
  sortBtnActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  sortBtnText: {
    color: Colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
  },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
    gap: 4,
  },
  registerBtnText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: Spacing.sm,
    alignItems: 'center',
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg.secondary,
    gap: 3,
  },
  filterPillActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  filterPillText: {
    color: Colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: Colors.bg.input,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    color: Colors.text.primary,
    fontSize: Typography.sm,
    marginBottom: Spacing.sm,
  },

  // List
  columnWrapper: {
    gap: 0,
  },
  listContent: {
    paddingBottom: Spacing['3xl'],
  },
  listEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 60,
  },
  emptyTitle: {
    color: Colors.text.secondary,
    fontSize: Typography.lg,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: Colors.text.muted,
    fontSize: Typography.sm,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
});
