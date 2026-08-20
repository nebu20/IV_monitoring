/**
 * IV Registration Wizard
 * ======================
 * Form to pair a physical sensor with a patient's IV line.
 * Validates inputs and POSTs to /api/iv/register.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { API } from '../constants/config';
import { IVRegisterRequest } from '../types';

const FLUID_OPTIONS = ['NS 0.9%', 'D5W', 'Lactated Ringer', 'D5NS', 'D10W', 'Other'];
const BAG_SIZES = [250, 500, 1000];
const SENSOR_IDS = ['SENS-101', 'SENS-102', 'SENS-103', 'SENS-104', 'SENS-105', 'SENS-106'];

interface FormState {
  patient_id: string;
  patient_name: string;
  room_bed: string;
  iv_id: string;
  fluid_name: string;
  bag_size_ml: number;
  prescribed_rate_gtt_min: string;
  sensor_id: string;
}

const DEFAULT_FORM: FormState = {
  patient_id: '',
  patient_name: '',
  room_bed: '',
  iv_id: '',
  fluid_name: 'NS 0.9%',
  bag_size_ml: 500,
  prescribed_rate_gtt_min: '30',
  sensor_id: 'SENS-101',
};

export default function RegisterScreen() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);

  const update = (key: keyof FormState, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): string | null => {
    if (!form.patient_id.trim()) return 'Patient ID is required';
    if (!form.patient_name.trim()) return 'Patient name is required';
    if (!form.room_bed.trim()) return 'Room/Bed is required';
    if (!form.iv_id.trim()) return 'IV ID is required';
    const rate = parseFloat(form.prescribed_rate_gtt_min);
    if (isNaN(rate) || rate <= 0) return 'Prescribed rate must be a positive number';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      Alert.alert('Validation Error', err);
      return;
    }

    const payload: IVRegisterRequest = {
      patient_id: form.patient_id.trim(),
      patient_name: form.patient_name.trim(),
      room_bed: form.room_bed.trim(),
      iv_id: form.iv_id.trim(),
      fluid_name: form.fluid_name,
      bag_size_ml: form.bag_size_ml,
      prescribed_rate_gtt_min: parseFloat(form.prescribed_rate_gtt_min),
      sensor_id: form.sensor_id,
    };

    setLoading(true);
    try {
      const res = await fetch(API.REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        Alert.alert('Success', data.message, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        const err = await res.json();
        Alert.alert('Registration Failed', err.detail ?? 'Unknown error');
      }
    } catch (e) {
      Alert.alert('Network Error', 'Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.pageTitle}>New IV Registration</Text>
        <Text style={styles.pageSubtitle}>
          Bind a sensor to a patient's IV line to begin monitoring.
        </Text>

        {/* Patient section */}
        <SectionHeader icon="person-outline" title="Patient Information" />
        <FormField label="Patient ID *" placeholder="e.g. PAT-001">
          <TextInput
            style={styles.input}
            placeholder="PAT-001"
            placeholderTextColor={Colors.text.muted}
            value={form.patient_id}
            onChangeText={(v) => update('patient_id', v)}
            autoCapitalize="characters"
          />
        </FormField>
        <FormField label="Patient Name *" placeholder="">
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={Colors.text.muted}
            value={form.patient_name}
            onChangeText={(v) => update('patient_name', v)}
          />
        </FormField>
        <FormField label="Room / Bed *" placeholder="">
          <TextInput
            style={styles.input}
            placeholder="e.g. 3A-02"
            placeholderTextColor={Colors.text.muted}
            value={form.room_bed}
            onChangeText={(v) => update('room_bed', v)}
            autoCapitalize="characters"
          />
        </FormField>

        {/* IV section */}
        <SectionHeader icon="water-outline" title="IV Line Details" />
        <FormField label="IV Line ID *" placeholder="">
          <TextInput
            style={styles.input}
            placeholder="e.g. IV-2024-001"
            placeholderTextColor={Colors.text.muted}
            value={form.iv_id}
            onChangeText={(v) => update('iv_id', v)}
            autoCapitalize="characters"
          />
        </FormField>

        {/* Fluid type */}
        <FormField label="Fluid Type *" placeholder="">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionScroll}>
            <View style={styles.optionRow}>
              {FLUID_OPTIONS.map((fluid) => (
                <TouchableOpacity
                  key={fluid}
                  style={[styles.optionBtn, form.fluid_name === fluid && styles.optionBtnActive]}
                  onPress={() => update('fluid_name', fluid)}
                >
                  <Text style={[styles.optionBtnText, form.fluid_name === fluid && styles.optionBtnTextActive]}>
                    {fluid}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </FormField>

        {/* Bag size */}
        <FormField label="Bag Size *" placeholder="">
          <View style={styles.optionRow}>
            {BAG_SIZES.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.optionBtn, form.bag_size_ml === size && styles.optionBtnActive]}
                onPress={() => update('bag_size_ml', size)}
              >
                <Text style={[styles.optionBtnText, form.bag_size_ml === size && styles.optionBtnTextActive]}>
                  {size} mL
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormField>

        {/* Prescribed rate */}
        <FormField label="Prescribed Rate (gtt/min) *" placeholder="">
          <TextInput
            style={styles.input}
            placeholder="e.g. 30"
            placeholderTextColor={Colors.text.muted}
            value={form.prescribed_rate_gtt_min}
            onChangeText={(v) => update('prescribed_rate_gtt_min', v)}
            keyboardType="numeric"
          />
        </FormField>

        {/* Sensor */}
        <SectionHeader icon="hardware-chip-outline" title="Sensor Assignment" />
        <FormField label="Sensor ID *" placeholder="">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionScroll}>
            <View style={styles.optionRow}>
              {SENSOR_IDS.map((sid) => (
                <TouchableOpacity
                  key={sid}
                  style={[styles.optionBtn, form.sensor_id === sid && styles.optionBtnActive]}
                  onPress={() => update('sensor_id', sid)}
                >
                  <Text style={[styles.optionBtnText, form.sensor_id === sid && styles.optionBtnTextActive]}>
                    {sid}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </FormField>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.text.inverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={Colors.text.inverse} />
              <Text style={styles.submitText}>Register IV Line</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sectionStyles.row}>
      <Ionicons name={icon as any} size={16} color={Colors.accent} />
      <Text style={sectionStyles.title}>{title}</Text>
    </View>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <View style={fieldStyles.container}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg.primary },
  scroll: { flex: 1 },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.sm,
  },
  pageTitle: {
    color: Colors.text.primary,
    fontSize: Typography['2xl'],
    fontWeight: '800',
    marginBottom: 4,
  },
  pageSubtitle: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
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
  optionScroll: { marginTop: 4 },
  optionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  optionBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg.input,
  },
  optionBtnActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  optionBtnText: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  optionBtnTextActive: {
    color: Colors.accent,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: {
    color: Colors.text.inverse,
    fontSize: Typography.md,
    fontWeight: '800',
  },
});

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: Spacing.sm,
  },
  title: {
    color: Colors.text.secondary,
    fontSize: Typography.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

const fieldStyles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    color: Colors.text.secondary,
    fontSize: Typography.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
