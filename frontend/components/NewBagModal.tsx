/**
 * NewBagModal — Pop-up asking the nurse to confirm a new bag installation
 * when the backend detects a significant weight spike.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';

const BAG_SIZES = [250, 500, 1000];

interface Props {
  visible: boolean;
  ivId: string | null;
  onConfirm: (ivId: string, bagSizeMl: number, notes?: string) => Promise<void>;
  onDismiss: () => void;
}

export function NewBagModal({ visible, ivId, onConfirm, onDismiss }: Props) {
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          {/* Icon + title */}
          <View style={styles.iconRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="water" size={26} color={Colors.accent} />
            </View>
          </View>

          <Text style={styles.title}>New Bag Detected</Text>
          <Text style={styles.subtitle}>
            Significant weight increase detected on {ivId ?? '—'}.{'\n'}
            Confirm new bag installation to reset volume and ETA.
          </Text>

          {/* Bag size selector */}
          <Text style={styles.sectionLabel}>Select Bag Size</Text>
          <View style={styles.sizeRow}>
            {BAG_SIZES.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.sizeBtn, selectedSize === size && !customSize && styles.sizeBtnSelected]}
                onPress={() => {
                  setSelectedSize(size);
                  setCustomSize('');
                }}
              >
                <Text
                  style={[
                    styles.sizeBtnText,
                    selectedSize === size && !customSize && styles.sizeBtnTextSelected,
                  ]}
                >
                  {size} mL
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Custom size (mL)"
            placeholderTextColor={Colors.text.muted}
            keyboardType="numeric"
            value={customSize}
            onChangeText={setCustomSize}
          />

          {/* Notes */}
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Nurse notes (optional)"
            placeholderTextColor={Colors.text.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss}>
              <Text style={styles.dismissText}>Not Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, loading && styles.btnDisabled]}
              onPress={handleConfirm}
              disabled={loading}
            >
              <Ionicons name="checkmark-circle" size={18} color={Colors.text.inverse} />
              <Text style={styles.confirmText}>
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg.modal,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing['2xl'],
    paddingBottom: Spacing['3xl'],
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  iconRow: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.accentMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: Colors.text.primary,
    fontSize: Typography.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  sectionLabel: {
    color: Colors.text.secondary,
    fontSize: Typography.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
  },
  sizeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  sizeBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.bg.input,
  },
  sizeBtnSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  sizeBtnText: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  sizeBtnTextSelected: {
    color: Colors.accent,
  },
  input: {
    backgroundColor: Colors.bg.input,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text.primary,
    fontSize: Typography.base,
  },
  notesInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  dismissBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  dismissText: {
    color: Colors.text.secondary,
    fontSize: Typography.base,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    gap: Spacing.sm,
  },
  confirmText: {
    color: Colors.text.inverse,
    fontSize: Typography.base,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
