/**
 * Admin Dashboard — System Overview
 * ===================================
 * Nurse Account Provisioning, Bed-to-Nurse Assignments, Node Health.
 * Card Room is managed externally via Postman/REST API — not in this UI.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { BASE_URL } from '../../constants/config';
import { Typography, Spacing, Radius } from '../../constants/theme';

interface NurseUser {
  id: number;
  username: string;
  role: string;
  full_name?: string;
  staff_id?: string;
  license_id?: string;
  assigned_ward?: string;
  assigned_beds: string[];
}

export default function AdminDashboard() {
  const { theme } = useTheme();
  const { user, isAdmin } = useAuthStore();
  const [tab, setTab] = useState<'nurses' | 'system'>('nurses');
  const [nurses, setNurses] = useState<NurseUser[]>([]);
  const [patients, setPatients] = useState<number>(0);
  const [activeBeds, setActiveBeds] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // New account form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'Nurse' | 'Admin'>('Nurse');
  const [newFullName, setNewFullName] = useState('');
  const [newStaffId, setNewStaffId] = useState('');
  const [newLicenseId, setNewLicenseId] = useState('');
  const [newWard, setNewWard] = useState('');
  const [newBeds, setNewBeds] = useState('');
  const [creating, setCreating] = useState(false);

  // HR lookup state
  const [hrLookupLoading, setHrLookupLoading] = useState(false);
  const [hrRecord, setHrRecord] = useState<any>(null);
  const [hrError, setHrError] = useState<string | null>(null);

  const authHeader = { Authorization: `Bearer ${user?.token ?? ''}` };

  // Redirect non-admins
  useEffect(() => {
    if (user && !isAdmin()) router.replace('/');
  }, [user]);

  // HR staff lookup
  const lookupStaff = async () => {
    if (!newStaffId.trim()) return;
    setHrLookupLoading(true);
    setHrRecord(null);
    setHrError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/staff/${newStaffId.trim()}`, { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setHrRecord(data);
        // Auto-populate fields
        setNewFullName(data.full_name ?? '');
        setNewWard(data.ward ?? '');
        setNewLicenseId(data.license_id ?? '');
      } else {
        const e = await res.json();
        setHrError(e.detail ?? 'Staff ID not found in HR database');
      }
    } catch {
      setHrError('Cannot reach server');
    } finally {
      setHrLookupLoading(false);
    }
  };

  const fetchNurses = useCallback(async () => {
    const res = await fetch(`${BASE_URL}/api/auth/users`, { headers: authHeader });
    if (res.ok) setNurses(await res.json());
  }, []);

  const loadAll = async () => {
    setLoading(true);
    await fetchNurses();
    try {
      const res = await fetch(`${BASE_URL}/api/patients`, { headers: authHeader });
      if (res.ok) { const d = await res.json(); setPatients(d.length); }
    } catch { }
    try {
      const res = await fetch(`${BASE_URL}/api/beds/live-status`, { headers: authHeader });
      if (res.ok) { const d = await res.json(); setActiveBeds(d); }
    } catch { }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  useEffect(() => { loadAll(); }, []);

  const createNurse = async () => {
    // Mandatory field validation
    if (!newFullName.trim()) { Alert.alert('Required', 'Full Name is required'); return; }
    if (!newUsername.trim()) { Alert.alert('Required', 'Username is required'); return; }
    if (!newPassword.trim()) { Alert.alert('Required', 'Password is required'); return; }
    if (!newStaffId.trim()) { Alert.alert('Required', 'Staff ID is required'); return; }
    if (newRole === 'Nurse' && !newLicenseId.trim()) {
      Alert.alert('Required', 'License / Badge ID is required for Nurse accounts');
      return;
    }

    // Block if HR lookup failed
    if (hrError) { Alert.alert('HR Verification Failed', hrError); return; }

    // Block if HR record exists but license not active
    if (hrRecord && hrRecord.license_status !== 'ACTIVE') {
      Alert.alert('License Issue', `Staff license status is ${hrRecord.license_status}. Cannot create account.`);
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          full_name: newFullName.trim(),
          staff_id: newStaffId.trim(),
          license_id: newLicenseId.trim() || undefined,
          assigned_ward: newWard.trim() || undefined,
          assigned_beds: newRole === 'Nurse'
            ? newBeds.split(',').map((b) => b.trim()).filter(Boolean)
            : [],
        }),
      });
      if (res.ok) {
        setNewUsername(''); setNewPassword(''); setNewFullName('');
        setNewStaffId(''); setNewLicenseId(''); setNewWard(''); setNewBeds('');
        setHrRecord(null); setHrError(null);
        await fetchNurses();
        Alert.alert('✅ Account Created', `${newUsername} can now log in.`);
      } else {
        const e = await res.json();
        Alert.alert('Error', e.detail ?? 'Failed to create account');
      }
    } catch {
      Alert.alert('Error', 'Network error');
    } finally {
      setCreating(false);
    }
  };

  const updateBeds = async (userId: number, beds: string) => {
    const assigned_beds = beds.split(',').map((b) => b.trim()).filter(Boolean);
    const res = await fetch(`${BASE_URL}/api/auth/users/${userId}/beds`, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_beds }),
    });
    if (res.ok) {
      await fetchNurses();
      Alert.alert('Updated', 'Bed assignments saved.');
    }
  };

  const inputStyle = [styles.input, {
    backgroundColor: theme.bg.input,
    borderColor: theme.border,
    color: theme.text.primary,
  }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text.primary }]}>Admin Panel</Text>
        <View style={[styles.adminBadge, { backgroundColor: theme.accentMuted }]}>
          <Ionicons name="shield-checkmark" size={13} color={theme.accent} />
          <Text style={[styles.adminBadgeText, { color: theme.accent }]}>Admin</Text>
        </View>
      </View>

      {/* Tabs — Nurses and System only */}
      <View style={[styles.tabBar, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        {(['nurses', 'system'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && { borderBottomColor: theme.accent, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, { color: tab === t ? theme.accent : theme.text.muted }]}>
              {t === 'nurses' ? '👩‍⚕️ Nurse Accounts' : '📡 System Health'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
      >
        {loading && <ActivityIndicator color={theme.accent} style={{ margin: Spacing.xl }} />}

        {/* ── Nurse Accounts Tab ── */}
        {tab === 'nurses' && (
          <>
            {/* Create account form */}
            <SectionHeader theme={theme} icon="person-add-outline" title="Create Nurse / Admin Account" />
            <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>

              {/* Role selector — prominent at top */}
              <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Account Role</Text>
              <View style={styles.roleRow}>
                {(['Nurse', 'Admin'] as const).map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleBtn, {
                      borderColor: newRole === r ? theme.accent : theme.border,
                      backgroundColor: newRole === r ? theme.accentMuted : theme.bg.input,
                      borderWidth: newRole === r ? 2 : 1,
                    }]}
                    onPress={() => setNewRole(r)}
                  >
                    <Ionicons
                      name={r === 'Admin' ? 'shield-checkmark' : 'person-circle'}
                      size={20} color={newRole === r ? theme.accent : theme.text.secondary}
                    />
                    <View>
                      <Text style={[styles.roleBtnText, { color: newRole === r ? theme.accent : theme.text.primary }]}>
                        {r}
                      </Text>
                      <Text style={[styles.roleBtnDesc, { color: newRole === r ? theme.accent : theme.text.muted }]}>
                        {r === 'Nurse' ? 'Assigned beds only' : 'Full system access'}
                      </Text>
                    </View>
                    {newRole === r && (
                      <Ionicons name="checkmark-circle" size={18} color={theme.accent} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              {/* Login Credentials */}
              <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Login Credentials</Text>
              <TextInput
                style={inputStyle}
                placeholder="Username *"
                placeholderTextColor={theme.text.muted}
                value={newUsername}
                onChangeText={setNewUsername}
                autoCapitalize="none"
              />
              <TextInput
                style={inputStyle}
                placeholder="Password *"
                placeholderTextColor={theme.text.muted}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              {/* HR Verification */}
              <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>HR Verification *</Text>
              <Text style={[styles.fieldHint, { color: theme.text.muted }]}>
                Enter Staff ID to auto-fill from HR database
              </Text>

              {/* Staff ID lookup row */}
              <View style={styles.lookupRow}>
                <TextInput
                  style={[inputStyle, { flex: 1 }]}
                  placeholder="Staff ID *"
                  placeholderTextColor={theme.text.muted}
                  value={newStaffId}
                  onChangeText={(v) => {
                    setNewStaffId(v);
                    // Reset HR state when user edits staff ID
                    if (hrRecord || hrError) {
                      setHrRecord(null);
                      setHrError(null);
                    }
                  }}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[styles.lookupBtn, {
                    backgroundColor: theme.accent,
                    opacity: hrLookupLoading ? 0.6 : 1,
                  }]}
                  onPress={lookupStaff}
                  disabled={hrLookupLoading || !newStaffId.trim()}
                >
                  {hrLookupLoading
                    ? <ActivityIndicator color={theme.text.inverse} size="small" />
                    : <Ionicons name="search" size={18} color={theme.text.inverse} />
                  }
                </TouchableOpacity>
              </View>

              {/* HR Error box */}
              {hrError && (
                <View style={[styles.hrErrorBox, {
                  backgroundColor: theme.status.criticalBg ?? 'rgba(239,68,68,0.1)',
                  borderColor: theme.status.critical ?? '#EF4444',
                }]}>
                  <Ionicons name="warning-outline" size={16} color={theme.status.critical ?? '#EF4444'} />
                  <Text style={[styles.hrErrorText, { color: theme.status.critical ?? '#EF4444' }]}>
                    {hrError}
                  </Text>
                </View>
              )}

              {/* HR Found box */}
              {hrRecord && (
                <View style={[styles.hrFoundBox, {
                  backgroundColor: theme.status.normalBg ?? 'rgba(34,197,94,0.1)',
                  borderColor: theme.status.normal ?? '#22C55E',
                }]}>
                  <View style={styles.hrFoundHeader}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.status.normal ?? '#22C55E'} />
                    <Text style={[styles.hrFoundTitle, { color: theme.status.normal ?? '#22C55E' }]}>
                      HR Record Found — {hrRecord.license_status}
                    </Text>
                  </View>
                  {hrRecord.full_name && (
                    <Text style={[styles.hrFoundDetail, { color: theme.text.secondary }]}>
                      Name: {hrRecord.full_name}
                    </Text>
                  )}
                  {hrRecord.role_title && (
                    <Text style={[styles.hrFoundDetail, { color: theme.text.secondary }]}>
                      Role: {hrRecord.role_title}
                    </Text>
                  )}
                  {hrRecord.department && (
                    <Text style={[styles.hrFoundDetail, { color: theme.text.secondary }]}>
                      Department: {hrRecord.department}
                    </Text>
                  )}
                  {hrRecord.license_id && (
                    <Text style={[styles.hrFoundDetail, { color: theme.text.secondary }]}>
                      License ID: {hrRecord.license_id}
                    </Text>
                  )}
                </View>
              )}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              {/* Identity Details */}
              <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Identity Details *</Text>
              <TextInput
                style={inputStyle}
                placeholder="Full Name *"
                placeholderTextColor={theme.text.muted}
                value={newFullName}
                onChangeText={setNewFullName}
              />

              {/* License / Badge ID — Nurse only */}
              {newRole === 'Nurse' && (
                <TextInput
                  style={inputStyle}
                  placeholder="License / Badge ID *"
                  placeholderTextColor={theme.text.muted}
                  value={newLicenseId}
                  onChangeText={setNewLicenseId}
                  autoCapitalize="characters"
                />
              )}

              <TextInput
                style={inputStyle}
                placeholder="Ward * (e.g. 2A)"
                placeholderTextColor={theme.text.muted}
                value={newWard}
                onChangeText={setNewWard}
                autoCapitalize="characters"
              />

              {/* Bed assignments — Nurse only */}
              {newRole === 'Nurse' && (
                <>
                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                  <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Bed Assignments</Text>
                  <Text style={[styles.fieldHint, { color: theme.text.muted }]}>
                    Comma-separated bed IDs this nurse can monitor
                  </Text>
                  <TextInput
                    style={inputStyle}
                    placeholder="e.g. 2A-01, 2A-02, 2A-03"
                    placeholderTextColor={theme.text.muted}
                    value={newBeds}
                    onChangeText={setNewBeds}
                  />
                </>
              )}

              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: theme.accent }, creating && { opacity: 0.6 }]}
                onPress={createNurse}
                disabled={creating}
              >
                {creating
                  ? <ActivityIndicator color={theme.text.inverse} size="small" />
                  : <>
                    <Ionicons name="checkmark-circle" size={16} color={theme.text.inverse} />
                    <Text style={[styles.createBtnText, { color: theme.text.inverse }]}>
                      Create {newRole} Account
                    </Text>
                  </>
                }
              </TouchableOpacity>
            </View>

            {/* Existing accounts */}
            <SectionHeader theme={theme} icon="people-outline" title={`Accounts (${nurses.length})`} />
            {nurses.map((n) => (
              <NurseCard key={n.id} nurse={n} theme={theme} onUpdateBeds={(beds) => updateBeds(n.id, beds)} />
            ))}
          </>
        )}

        {/* ── System Health Tab ── */}
        {tab === 'system' && (
          <>
            <SectionHeader theme={theme} icon="pulse-outline" title="System Overview" />

            {/* Card Room / HIS Integration */}
            <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
              <View style={styles.widgetHeader}>
                <Ionicons name="card-outline" size={18} color={theme.accent} />
                <Text style={[styles.widgetTitle, { color: theme.text.primary }]}>Card Room / HIS Integration</Text>
                <View style={[styles.statusBadge, { backgroundColor: theme.status.normalBg }]}>
                  <View style={[styles.statusDot, { backgroundColor: theme.status.normal }]} />
                  <Text style={[styles.statusBadgeText, { color: theme.status.normal }]}>Connected</Text>
                </View>
              </View>
              <View style={styles.widgetStats}>
                <WidgetStat theme={theme} icon="people-outline" label="Synced Patients" value={`${patients}`} color={theme.accent} />
                <WidgetStat theme={theme} icon="time-outline" label="Last Sync" value="Live" color={theme.status.normal} />
                <WidgetStat theme={theme} icon="server-outline" label="Endpoint" value="REST API" color={theme.text.secondary} />
              </View>
            </View>

            {/* Telemetry Gateway */}
            <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
              <View style={styles.widgetHeader}>
                <Ionicons name="wifi-outline" size={18} color={theme.status.normal} />
                <Text style={[styles.widgetTitle, { color: theme.text.primary }]}>Telemetry Gateway</Text>
                <View style={[styles.statusBadge, { backgroundColor: theme.status.normalBg }]}>
                  <View style={[styles.statusDot, { backgroundColor: theme.status.normal }]} />
                  <Text style={[styles.statusBadgeText, { color: theme.status.normal }]}>Streaming</Text>
                </View>
              </View>
              <View style={styles.widgetStats}>
                <WidgetStat theme={theme} icon="radio-outline" label="Protocol" value="WebSocket" color={theme.accent} />
                <WidgetStat theme={theme} icon="speedometer-outline" label="Interval" value="3s" color={theme.status.normal} />
                <WidgetStat theme={theme} icon="hardware-chip-outline" label="Active Nodes" value={`${nurses.filter(n => n.role === 'Nurse').length * 2}`} color={theme.text.secondary} />
              </View>
            </View>

            {/* Ward Hardware Topology */}
            <SectionHeader theme={theme} icon="map-outline" title="Ward Hardware Topology" />
            <View style={[styles.topologyTable, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
              <View style={[styles.tableHeader, { backgroundColor: theme.bg.input }]}>
                {['Bed ID', 'Ward', 'Node ID', 'Status', 'Battery'].map((h) => (
                  <Text key={h} style={[styles.tableHeaderCell, { color: theme.text.muted }]}>{h}</Text>
                ))}
              </View>
              {activeBeds.length === 0 ? (
                <Text style={[styles.emptyTableText, { color: theme.text.muted }]}>
                  No active sessions
                </Text>
              ) : (
                activeBeds.map((bed, i) => (
                  <View key={bed.room_bed} style={[styles.tableRow, i % 2 === 0 && { backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
                    <Text style={[styles.tableCell, { color: theme.text.primary, fontWeight: '700' }]}>{bed.room_bed}</Text>
                    <Text style={[styles.tableCell, { color: theme.text.secondary }]}>{bed.room_bed.split('-')[0]}</Text>
                    <Text style={[styles.tableCell, { color: theme.text.secondary }]}>{bed.sensor_id}</Text>
                    <View style={[styles.tableCellBadge, { backgroundColor: theme.status.normalBg }]}>
                      <View style={[styles.statusDot, { backgroundColor: theme.status.normal, width: 6, height: 6 }]} />
                      <Text style={[styles.tableBadgeText, { color: theme.status.normal }]}>Online</Text>
                    </View>
                    <Text style={[styles.tableCell, { color: theme.text.secondary }]}>
                      {bed.battery_level != null ? `${bed.battery_level}%` : '—'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function WidgetStat({ icon, label, value, color, theme }: { icon: string; label: string; value: string; color: string; theme: any }) {
  return (
    <View style={wStyles.stat}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[wStyles.value, { color }]}>{value}</Text>
      <Text style={[wStyles.label, { color: theme.text.muted }]}>{label}</Text>
    </View>
  );
}

const wStyles = StyleSheet.create({
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  value: { fontSize: Typography.lg, fontWeight: '800' },
  label: { fontSize: 10, textAlign: 'center' },
});

function SectionHeader({ icon, title, theme }: { icon: string; title: string; theme: any }) {
  return (
    <View style={[styles.sectionRow, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon as any} size={15} color={theme.accent} />
      <Text style={[styles.sectionText, { color: theme.text.secondary }]}>{title}</Text>
    </View>
  );
}

function NurseCard({ nurse, theme, onUpdateBeds }: {
  nurse: NurseUser; theme: any; onUpdateBeds: (b: string) => void
}) {
  const [editing, setEditing] = useState(false);
  const [beds, setBeds] = useState(nurse.assigned_beds.join(', '));

  const roleLabel = nurse.role === 'Admin' ? 'Admin' : nurse.role === 'Superadmin' ? 'Superadmin' : 'Nurse';
  const roleColor = nurse.role === 'Superadmin'
    ? theme.status.advisory
    : nurse.role === 'Admin'
      ? theme.accent
      : theme.status.normal;
  const roleBg = nurse.role === 'Superadmin'
    ? theme.status.advisoryBg
    : nurse.role === 'Admin'
      ? theme.accentMuted
      : theme.status.normalBg;

  // Build enhanced display line: [Badge: Nurse] Almaz Kebede (ID: STF-2024-001 | Lic: RN-88492) — Ward 2A
  const buildDisplayLine = () => {
    const namePart = nurse.full_name ?? nurse.username;
    const idPart = nurse.staff_id ? `ID: ${nurse.staff_id}` : null;
    const licPart = nurse.license_id ? `Lic: ${nurse.license_id}` : null;
    const idBlock = [idPart, licPart].filter(Boolean).join(' | ');
    const wardPart = nurse.assigned_ward ? `— Ward ${nurse.assigned_ward}` : '';
    return [namePart, idBlock ? `(${idBlock})` : null, wardPart].filter(Boolean).join(' ');
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
      <View style={styles.nurseRow}>
        {/* Role badge */}
        <View style={[styles.roleChip, { backgroundColor: roleBg }]}>
          <Ionicons
            name={nurse.role === 'Superadmin' ? 'star' : nurse.role === 'Admin' ? 'shield-checkmark' : 'person'}
            size={12}
            color={roleColor}
          />
          <Text style={[styles.roleChipText, { color: roleColor }]}>
            {roleLabel}
          </Text>
        </View>

        {/* Main info */}
        <View style={{ flex: 1 }}>
          <Text style={[styles.nurseUsername, { color: theme.text.primary }]}>{nurse.username}</Text>
          <Text style={[styles.nurseFullName, { color: theme.text.muted }]} numberOfLines={2}>
            {buildDisplayLine()}
          </Text>
        </View>
      </View>

      {/* Bed assignments — only for Nurses */}
      {nurse.role === 'Nurse' && (
        editing ? (
          <View style={styles.bedsEditRow}>
            <TextInput
              style={[styles.bedsInput, {
                backgroundColor: theme.bg.input,
                borderColor: theme.accent,
                color: theme.text.primary,
              }]}
              value={beds}
              onChangeText={setBeds}
              placeholder="2A-01, 2A-02, 3B-01"
              placeholderTextColor={theme.text.muted}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: theme.accent }]}
              onPress={() => { onUpdateBeds(beds); setEditing(false); }}
            >
              <Text style={[styles.saveBtnText, { color: theme.text.inverse }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditing(false)}>
              <Ionicons name="close-circle-outline" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.bedsRow} onPress={() => setEditing(true)}>
            <Ionicons name="bed-outline" size={13} color={theme.text.muted} />
            <Text style={[styles.bedsText, { color: theme.text.secondary, flex: 1 }]}>
              {nurse.assigned_beds.length > 0
                ? `Beds: ${nurse.assigned_beds.join(' · ')}`
                : 'No beds assigned — tap to assign'}
            </Text>
            <Ionicons name="pencil-outline" size={13} color={theme.text.muted} />
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 90 },
  backText: { fontSize: Typography.sm, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
  },
  adminBadgeText: { fontSize: 11, fontWeight: '700' },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: {
    flex: 1, paddingVertical: Spacing.md, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabText: { fontSize: Typography.sm, fontWeight: '600' },

  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.sm },

  card: { borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1, gap: Spacing.sm },
  input: {
    borderRadius: Radius.sm, borderWidth: 1,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.sm,
  },
  roleRow: { gap: Spacing.sm },
  roleBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, gap: Spacing.sm,
  },
  roleBtnText: { fontSize: Typography.base, fontWeight: '700' },
  roleBtnDesc: { fontSize: Typography.xs, marginTop: 1 },
  divider: { height: 1, marginVertical: Spacing.sm },
  fieldLabel: { fontSize: Typography.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: Typography.xs, lineHeight: 16, marginTop: -Spacing.sm + 2 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, borderRadius: Radius.md, gap: Spacing.sm,
  },
  createBtnText: { fontSize: Typography.base, fontWeight: '700' },

  // HR lookup
  lookupRow: { flexDirection: 'row', gap: Spacing.sm },
  lookupBtn: {
    paddingHorizontal: Spacing.lg, borderRadius: Radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  hrErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.sm, borderRadius: Radius.sm, borderWidth: 1,
  },
  hrErrorText: { fontSize: Typography.xs, flex: 1 },
  hrFoundBox: {
    padding: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, gap: 4,
  },
  hrFoundHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hrFoundTitle: { fontSize: Typography.sm, fontWeight: '700' },
  hrFoundDetail: { fontSize: Typography.xs },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderBottomWidth: 1, paddingBottom: Spacing.sm, marginTop: Spacing.md,
  },
  sectionText: {
    fontSize: Typography.sm, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  nurseRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  roleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full,
  },
  roleChipText: { fontSize: 10, fontWeight: '700' },
  nurseUsername: { fontSize: Typography.base, fontWeight: '700' },
  nurseFullName: { fontSize: Typography.xs, marginTop: 1 },
  bedsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bedsText: { fontSize: Typography.xs },
  bedsEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bedsInput: {
    flex: 1, borderRadius: Radius.sm, borderWidth: 1,
    paddingHorizontal: Spacing.sm, paddingVertical: 5, fontSize: Typography.xs,
  },
  saveBtn: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.sm },
  saveBtnText: { fontSize: Typography.xs, fontWeight: '700' },

  widgetHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  widgetTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700' },
  widgetStats: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },

  topologyTable: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: 8 },
  tableHeaderCell: { flex: 1, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: 8 },
  tableCell: { flex: 1, fontSize: 11 },
  tableCellBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  tableBadgeText: { fontSize: 10, fontWeight: '600' },
  emptyTableText: { fontSize: Typography.sm, textAlign: 'center', padding: Spacing.lg },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  infoTitle: { fontSize: Typography.base, fontWeight: '700', marginBottom: 2 },
  infoDesc: { fontSize: Typography.xs, lineHeight: 18 },
  endpointBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.sm, borderRadius: Radius.sm, borderWidth: 1,
  },
  endpointMethod: { fontSize: Typography.xs, fontWeight: '800', width: 36 },
  endpointPath: { fontSize: Typography.xs, fontFamily: 'monospace', flex: 1 },
  payloadLabel: { fontSize: Typography.xs, marginTop: 4 },
  codeBox: { borderRadius: Radius.sm, padding: Spacing.md },
  codeText: { fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
});
