/**
 * EndSessionModal — web-compatible confirmation dialog for ending an IV session.
 * Replaces Alert.alert which does not work on web browsers.
 */

import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Props {
  visible: boolean;
  patientName: string;
  ivId: string;
  onConfirm: (ivId: string) => Promise<void>;
  onCancel: () => void;
}

export function EndSessionModal({ visible, patientName, ivId, onConfirm, onCancel }: Props) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm(ivId);
    setLoading(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.bg.modal, borderColor: theme.border }]}>

          <View style={[styles.iconCircle, { backgroundColor: theme.status.criticalBg }]}>
            <Ionicons name="stop-circle" size={32} color={theme.status.critical} />
          </View>

          <Text style={[styles.title, { color: theme.text.primary }]}>End IV Session</Text>
          <Text style={[styles.subtitle, { color: theme.text.secondary }]}>
            Are you sure you want to end the IV session for{'\n'}
            <Text style={{ fontWeight: '800', color: theme.text.primary }}>{patientName}</Text>?
          </Text>
          <Text style={[styles.warning, { color: theme.text.muted }]}>
            This will release the bed and archive the session in History.
          </Text>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: theme.border }]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={[styles.cancelText, { color: theme.text.secondary }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: theme.status.critical }, loading && { opacity: 0.6 }]}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="stop-circle-outline" size={16} color="#fff" />
                  <Text style={styles.confirmText}>End Session</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.xl,
    padding: Spacing['2xl'],
    borderWidth: 1,
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontSize: Typography.xl, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: Typography.base, textAlign: 'center', lineHeight: 24 },
  warning: { fontSize: Typography.sm, textAlign: 'center', lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: Spacing.md, width: '100%', marginTop: Spacing.sm },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, alignItems: 'center',
  },
  cancelText: { fontSize: Typography.base, fontWeight: '600' },
  confirmBtn: {
    flex: 2, flexDirection: 'row', paddingVertical: Spacing.md,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  confirmText: { fontSize: Typography.base, fontWeight: '700', color: '#fff' },
});
