/**
 * Login Screen
 * ============
 * Unauthenticated users land here. JWT stored in AsyncStorage.
 * Redirects to dashboard on success.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { Typography, Spacing, Radius } from '../constants/theme';

export default function LoginScreen() {
  const { theme } = useTheme();
  const { login, loading, error } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    const ok = await login(username.trim(), password);
    if (ok) router.replace('/');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.container}>
          {/* Logo / Header */}
          <View style={styles.logoRow}>
            <View style={[styles.logoCircle, { backgroundColor: theme.accentMuted }]}>
              <Ionicons name="water" size={36} color={theme.accent} />
            </View>
          </View>
          <Text style={[styles.title, { color: theme.text.primary }]}>IV Monitor</Text>
          <Text style={[styles.subtitle, { color: theme.text.secondary }]}>
            Central Nurse Station — Sign In
          </Text>

          {/* Form card */}
          <View style={[styles.card, { backgroundColor: theme.bg.card, borderColor: theme.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Username</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.bg.input, borderColor: theme.border, color: theme.text.primary }]}
              placeholder="Enter username"
              placeholderTextColor={theme.text.muted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>Password</Text>
            <View style={styles.pwdRow}>
              <TextInput
                style={[styles.input, styles.pwdInput, { backgroundColor: theme.bg.input, borderColor: theme.border, color: theme.text.primary }]}
                placeholder="Enter password"
                placeholderTextColor={theme.text.muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPwd}
              />
              <TouchableOpacity
                style={[styles.eyeBtn, { backgroundColor: theme.bg.input, borderColor: theme.border }]}
                onPress={() => setShowPwd(!showPwd)}
              >
                <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={theme.text.muted} />
              </TouchableOpacity>
            </View>

            {error && (
              <View style={[styles.errorBox, { backgroundColor: theme.status.criticalBg, borderColor: theme.status.criticalBorder }]}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.status.critical} />
                <Text style={[styles.errorText, { color: theme.status.critical }]}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: theme.accent }, loading && { opacity: 0.6 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.text.inverse} />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={20} color={theme.text.inverse} />
                  <Text style={[styles.loginBtnText, { color: theme.text.inverse }]}>Sign In</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

         
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['2xl'], gap: Spacing.sm },
  logoRow: { alignItems: 'center', marginBottom: Spacing.sm },
  logoCircle: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: Typography['3xl'], fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: Typography.sm, textAlign: 'center', marginBottom: Spacing.lg },
  card: { borderRadius: Radius.lg, padding: Spacing['2xl'], borderWidth: 1, gap: Spacing.sm },
  fieldLabel: { fontSize: Typography.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, fontSize: Typography.base },
  pwdRow: { flexDirection: 'row', gap: Spacing.sm },
  pwdInput: { flex: 1 },
  eyeBtn: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.sm, justifyContent: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.sm, borderWidth: 1 },
  errorText: { fontSize: Typography.sm, flex: 1 },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.lg, borderRadius: Radius.md, gap: Spacing.sm, marginTop: Spacing.sm },
  loginBtnText: { fontSize: Typography.md, fontWeight: '700' },
  hint: { fontSize: Typography.xs, textAlign: 'center', marginTop: Spacing.md },
});
