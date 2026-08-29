import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

const BAG_SIZES = [250, 500, 1000];

interface Props {
  visible: boolean;
  ivId: string | null;
  onConfirm: (ivId: string, bagSizeMl: number, notes?: string) => Promise<void>;
  onDismiss: () => void;
}

export function NewBagModal({ visible, ivId, onConfirm, onDismiss }: Props) {
  const { theme } = useTheme();
  const [selectedSize, setSelectedSize] = useState<number>(500);
  const [customSize, setCustomSize] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const effectiveSize = customSize.trim() ? parseFloat(customSize) : selectedSize;

  const handleConfirm = async () => {
    if (!ivId || isNaN(effectiveSize) || effectiveSize <= 0) return;
    setLoading(true);
    await onConfirm(ivId, effectiveSize, notes || undefined);
    setLoading(false);
    setNotes('');
    setCustomSize('');
  };

  const inputStyle = [styles.input, { backgroundColor: theme.bg.input, borderColor: theme.border, color: theme.text.primary }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.bg.modal, borderTopColor: theme.border }]}>

          <View style={styles.iconRow}>
            <View style={[styles.iconCircle, { backgroundColor: theme.accentMuted }]}>
              <Ionicons name="water" size={26} color={theme.accent} />
            </View>
          </View>

          <Text style={[styles.title, { color: theme.text.primary }]}>New Bag Detected</Text>
          <Text style={[styles.subtitle, { color: theme.text.secondary }]}>
            Significant weight increase detected on {ivId ?? '—'}.{'\n'}
            Confirm new bag installation to reset volume and ETA.
          </Text>

          <Text style={[styles.sectionLabel, { color: theme.text.secondary }]}>Select Bag Size</Text>
          <View style={styles.sizeRow}>
            {BAG_SIZES.map((size) => (
              <TouchableOpacity key={size}
                style={[styles.sizeBtn, {
                  borderColor: selectedSize === size && !customSize ? theme.accent : theme.border,
                  backgroundColor: selectedSize === size && !customSize ? theme.accentMuted : theme.bg.input,
                }]}
                onPress={() => { setSelectedSize(size); setCustomSize(''); }}>
                <Text style={[styles.sizeBtnText, { color: selectedSize === size && !customSize ? theme.accent : theme.text.secondary }]}>
                  {size} mL
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput style={inputStyle} placeholder="Custom size (mL)" placeholderTextColor={theme.text.muted}
            keyboardType="numeric" value={customSize} onChangeText={setCustomSize} />

          <TextInput style={[inputStyle, styles.notesInput]} placeholder="Nurse notes (optional)"
            placeholderTextColor={theme.text.muted} value={notes} onChangeText={setNotes} multiline />

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.dismissBtn, { borderColor: theme.border }]} onPress={onDismiss}>
              <Text style={[styles.dismissText, { color: theme.text.secondary }]}>Not Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: theme.accent }, loading && styles.btnDisabled]}
              onPress={handleConfirm} disabled={loading}>
              <Ionicons name="checkmark-circle" size={18} color={theme.text.inverse} />
              <Text style={[styles.confirmText, { color: theme.text.inverse }]}>
                {loading ? 'Confirming…' : 'Confirm New Bag'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing['2xl'], paddingBottom: Spacing['3xl'], gap: Spacing.md, borderTopWidth: 1 },
  iconRow: { alignItems: 'center' },
  iconCircle: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: Typography.xl, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: Typography.sm, textAlign: 'center', lineHeight: 20 },
  sectionLabel: { fontSize: Typography.xs, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.sm },
  sizeRow: { flexDirection: 'row', gap: Spacing.sm },
  sizeBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  sizeBtnText: { fontSize: Typography.sm, fontWeight: '600' },
  input: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.base },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  dismissBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  dismissText: { fontSize: Typography.base, fontWeight: '600' },
  confirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, gap: Spacing.sm },
  confirmText: { fontSize: Typography.base, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
