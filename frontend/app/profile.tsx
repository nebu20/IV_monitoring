/**
 * User Profile & Settings Screen
 * ================================
 * Available to all authenticated users (Nurse, Admin, Superadmin).
 * - View account details, ward, and bed assignments
 * - Update full name and staff ID
 * - Change password
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { BASE_URL } from '../constants/config';
import { Typography, Spacing, Radius } from '../constants/theme';

export default function ProfileScreen() {
  const { theme } = useTheme();
  const { user, login } = useAuthStore();

  // Profile fields
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [staffId, setStaffId] = useState(user?.staff_id ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password fields
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  const authHeader = { Authorization: `Bearer ${user?.token ?? ''}` };
  const inputStyle = [styles.input, {
    backgroundColor: theme.bg.input,
    borderColor: theme.border,
    color: theme.text.primary,
  }];

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch(`${BASE_URL}/api/users/profile`, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim() || undefined,
          staff_id: staffId.trim() || undefined,
        }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', 'Your profile has been updated.');
      } else {
        const e = await res.json();
        Alert.alert('Error', e.detail ?? 'Could not update profile');
      }
    } catch {
      Alert.alert('Error', 'Network error');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPwd || !newPwd) {
      Alert.alert('Error', 'All password fields are required');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }

    setSavingPwd(true);
    try {
      const res = await fetch(`${BASE_URL}/api/users/change-password`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPwd,
          new_password: newPwd,
        }),
      });
      if (res.ok) {
        setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
        Alert.alert('✅ Password Changed', 'Your password has been updated successfully.');
      } else {
        const e = await res.json();
        Alert.alert('Error', e.detail ?? 'Could not change password');
      }
    } catch {
      Alert.alert('Error', 'Network error');
    } finally {
      setSavingPwd(false);
    }
  };

  const roleColor = () => {
    if (user?.role === 'Superadmin') return theme.status.advisory;
    if (user?.role === 'Admin') return theme.accent;
    return theme.status.normal;
  };

  const roleLabel = () => {
    if (user?.role === 'Superadmin') return 'System Superadmin';
    if (user?.role === 'Admin') return 'Ward Administrator';
    return 'Nurse';
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>

      {/* Nav */}
      <View style={[styles.navBar, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text.primary }]}>My Profile</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Account Overview Card */}
        <View style={[styles.overviewCard, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
          <View style={[styles.avatarCircle, { backgroundColor: theme.accentMuted }]}>
            <Ionicons
              name={user?.role === 'Superadmin' ? 'star' : user?.role === 'Admin' ? 'shield-checkmark' : 'person-circle'}
              size={36} color={roleColor()}
            />
          </View>
          <Text style={[styles.overviewName, { color: theme.text.primary }]}>
            {user?.full_name ?? user?.username}
          </Text>
          <View style={[styles.roleBadge, { backgroundColor: theme.accentMuted }]}>
            <Text style={[styles.roleBadgeText, { color: roleColor() }]}>{roleLabel()}</Text>
          </View>

          <View style={styles.overviewDetails}>
            <DetailRow theme={theme} icon="person-outline" label="Username" value={user?.username ?? '—'} />
            {user?.staff_id && <DetailRow theme={theme} icon="card-outline" label="Staff ID" value={user.staff_id} />}
            {user?.assigned_ward && <DetailRow theme={theme} icon="map-outline" label="Ward" value={`Ward ${user.assigned_ward}`} />}
            {user?.role === 'Nurse' && user.assigned_beds?.length > 0 && (
              <DetailRow theme={theme} icon="bed-outline" label="Assigned Beds"
                value={user.assigned_beds.join(' · ')} />
            )}
          </View>
        </View>

        {/* Edit Profile */}
        <SectionHeader theme={theme} icon="create-outline" title="Edit Profile" />
        <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
          <FieldLabel theme={theme} label="Full Name" />
          <TextInput
            style={inputStyle}
            placeholder="Your full name"
            placeholderTextColor={theme.text.muted}
            value={fullName}
            onChangeText={setFullName}
          />
          <FieldLabel theme={theme} label="Staff ID" />
          <TextInput
            style={inputStyle}
            placeholder="e.g. STF-2024-001"
            placeholderTextColor={theme.text.muted}
            value={staffId}
            onChangeText={setStaffId}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: theme.accent }, savingProfile && { opacity: 0.6 }]}
            onPress={saveProfile}
            disabled={savingProfile}
          >
            {savingProfile
              ? <ActivityIndicator color={theme.text.inverse} size="small" />
              : <><Ionicons name="checkmark-circle" size={16} color={theme.text.inverse} />
                <Text style={[styles.saveBtnText, { color: theme.text.inverse }]}>Save Profile</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* Change Password */}
        <SectionHeader theme={theme} icon="lock-closed-outline" title="Change Password" />
        <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
          <FieldLabel theme={theme} label="Current Password" />
          <View style={styles.pwdRow}>
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="Enter current password"
              placeholderTextColor={theme.text.muted}
              value={currentPwd}
              onChangeText={setCurrentPwd}
              secureTextEntry={!showCurrentPwd}
            />
            <TouchableOpacity
              style={[styles.eyeBtn, { backgroundColor: theme.bg.input, borderColor: theme.border }]}
              onPress={() => setShowCurrentPwd(!showCurrentPwd)}
            >
              <Ionicons name={showCurrentPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          <FieldLabel theme={theme} label="New Password" />
          <View style={styles.pwdRow}>
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="At least 6 characters"
              placeholderTextColor={theme.text.muted}
              value={newPwd}
              onChangeText={setNewPwd}
              secureTextEntry={!showNewPwd}
            />
            <TouchableOpacity
              style={[styles.eyeBtn, { backgroundColor: theme.bg.input, borderColor: theme.border }]}
              onPress={() => setShowNewPwd(!showNewPwd)}
            >
              <Ionicons name={showNewPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          <FieldLabel theme={theme} label="Confirm New Password" />
          <TextInput
            style={[inputStyle, confirmPwd && newPwd !== confirmPwd ? { borderColor: theme.status.critical } : {}]}
            placeholder="Repeat new password"
            placeholderTextColor={theme.text.muted}
            value={confirmPwd}
            onChangeText={setConfirmPwd}
            secureTextEntry
          />
          {confirmPwd && newPwd !== confirmPwd && (
            <Text style={[styles.mismatchText, { color: theme.status.critical }]}>
              Passwords do not match
            </Text>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: theme.status.advisory }, savingPwd && { opacity: 0.6 }]}
            onPress={changePassword}
            disabled={savingPwd}
          >
            {savingPwd
              ? <ActivityIndicator color={theme.text.inverse} size="small" />
              : <><Ionicons name="lock-closed" size={16} color={theme.text.inverse} />
                <Text style={[styles.saveBtnText, { color: theme.text.inverse }]}>Change Password</Text></>
            }
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ icon, title, theme }: { icon: string; title: string; theme: any }) {
  return (
    <View style={[styles.sectionRow, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon as any} size={15} color={theme.accent} />
      <Text style={[styles.sectionText, { color: theme.text.secondary }]}>{title}</Text>
    </View>
  );
}

function FieldLabel({ label, theme }: { label: string; theme: any }) {
  return <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>{label}</Text>;
}

function DetailRow({ icon, label, value, theme }: { icon: string; label: string; value: string; theme: any }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon as any} size={14} color={theme.text.muted} />
      <Text style={[styles.detailLabel, { color: theme.text.muted }]}>{label}:</Text>
      <Text style={[styles.detailValue, { color: theme.text.primary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 70 },
  backText: { fontSize: Typography.sm, fontWeight: '600' },
  navTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },

  overviewCard: { borderRadius: Radius.lg, padding: Spacing.xl, borderWidth: 1, alignItems: 'center', gap: Spacing.sm },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  overviewName: { fontSize: Typography.xl, fontWeight: '800' },
  roleBadge: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  roleBadgeText: { fontSize: Typography.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  overviewDetails: { width: '100%', gap: 6, marginTop: Spacing.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailLabel: { fontSize: Typography.xs, width: 90 },
  detailValue: { fontSize: Typography.xs, fontWeight: '600', flex: 1 },

  card: { borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1, gap: Spacing.sm },
  input: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, fontSize: Typography.base },
  pwdRow: { flexDirection: 'row', gap: Spacing.sm },
  eyeBtn: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.sm, justifyContent: 'center' },
  mismatchText: { fontSize: Typography.xs },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, gap: Spacing.sm, marginTop: 4 },
  saveBtnText: { fontSize: Typography.base, fontWeight: '700' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: 1, paddingBottom: Spacing.sm, marginTop: Spacing.sm },
  sectionText: { fontSize: Typography.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { fontSize: Typography.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
});
