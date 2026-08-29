/**
 * IV Registration Wizard — with Card Room lookup & contradiction alerts
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Typography, Spacing, Radius } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { API, BASE_URL } from '../constants/config';
import { IVRegisterRequest } from '../types';

const FLUID_OPTIONS = ['NS 0.9%', 'D5W', 'Lactated Ringer', 'D5NS', 'D10W', 'Other'];
const BAG_SIZES = [250, 500, 1000];
const SENSOR_IDS = ['SENS-101', 'SENS-102', 'SENS-103', 'SENS-104', 'SENS-105', 'SENS-106'];

interface CardPatient {
  card_id: string;
  patient_name: string;
  age?: number;
  prescribed_fluid?: string;
  target_volume_ml?: number;
  target_drop_rate?: number;
}

interface ContradictionWarning {
  field: string;
  prescribed: number;
  entered: number;
  variance: number;
}

interface FormState {
  card_id: string;
  patient_id: string;
  patient_name: string;
  age: string;
  room_bed: string;
  iv_id: string;
  fluid_name: string;
  bag_size_ml: number;
  prescribed_rate_gtt_min: string;
  sensor_id: string;
}

const DEFAULT_FORM: FormState = {
  card_id: '',
  patient_id: '',
  patient_name: '',
  age: '',
  room_bed: '',
  iv_id: '',
  fluid_name: 'NS 0.9%',
  bag_size_ml: 500,
  prescribed_rate_gtt_min: '30',
  sensor_id: 'SENS-101',
};

export default function RegisterScreen() {
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [cardLookupLoading, setCardLookupLoading] = useState(false);
  const [cardPatient, setCardPatient] = useState<CardPatient | null>(null);
  const [contradictions, setContradictions] = useState<ContradictionWarning[]>([]);

  const update = (key: keyof FormState, value: string | number) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      checkContradictions(next, cardPatient);
      return next;
    });

  // Card Room lookup
  const lookupCard = async () => {
    if (!form.card_id.trim()) return;
    setCardLookupLoading(true);
    try {
      const token = user?.token ?? '';
      const res = await fetch(`${BASE_URL}/api/patients/${form.card_id.trim()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: CardPatient = await res.json();
        setCardPatient(data);
        // Auto-populate fields from Card Room
        setForm((prev) => {
          const next = {
            ...prev,
            patient_name: data.patient_name,
            age: data.age?.toString() ?? '',
            fluid_name: data.prescribed_fluid ?? prev.fluid_name,
            bag_size_ml: data.target_volume_ml ?? prev.bag_size_ml,
            prescribed_rate_gtt_min: data.target_drop_rate?.toString() ?? prev.prescribed_rate_gtt_min,
          };
          checkContradictions(next, data);
          return next;
        });
      } else {
        setCardPatient(null);
        Alert.alert('Not Found', `No patient found with Card ID: ${form.card_id}`);
      }
    } catch {
      Alert.alert('Error', 'Could not reach server to look up Card ID.');
    } finally {
      setCardLookupLoading(false);
    }
  };

  // Contradiction detection — flag >10% variance from prescription
  const checkContradictions = (f: FormState, card: CardPatient | null) => {
    if (!card) { setContradictions([]); return; }
    const warnings: ContradictionWarning[] = [];

    const enteredRate = parseFloat(f.prescribed_rate_gtt_min);
    if (card.target_drop_rate && !isNaN(enteredRate)) {
      const variance = Math.abs(enteredRate - card.target_drop_rate) / card.target_drop_rate;
      if (variance > 0.10) {
        warnings.push({
          field: 'Drop Rate',
          prescribed: card.target_drop_rate,
          entered: enteredRate,
          variance: Math.round(variance * 100),
        });
      }
    }

    if (card.target_volume_ml && f.bag_size_ml) {
      const variance = Math.abs(f.bag_size_ml - card.target_volume_ml) / card.target_volume_ml;
      if (variance > 0.10) {
        warnings.push({
          field: 'Target Volume',
          prescribed: card.target_volume_ml,
          entered: f.bag_size_ml,
          variance: Math.round(variance * 100),
        });
      }
    }

    setContradictions(warnings);
  };

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
    if (err) { Alert.alert('Validation Error', err); return; }

    const payload: IVRegisterRequest & { card_id?: string } = {
      patient_id: form.patient_id.trim(),
      patient_name: form.patient_name.trim(),
      room_bed: form.room_bed.trim(),
      iv_id: form.iv_id.trim(),
      fluid_name: form.fluid_name,
      bag_size_ml: form.bag_size_ml,
      prescribed_rate_gtt_min: parseFloat(form.prescribed_rate_gtt_min),
      sensor_id: form.sensor_id,
      card_id: form.card_id.trim() || undefined,
    };

    setLoading(true);
    try {
      const token = user?.token ?? '';
      const res = await fetch(API.REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        Alert.alert('Success', data.message, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        const e = await res.json();
        Alert.alert('Registration Failed', e.detail ?? 'Unknown error');
      }
    } catch {
      Alert.alert('Network Error', 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.bg.input, borderColor: theme.border, color: theme.text.primary }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <Text style={[styles.pageTitle, { color: theme.text.primary }]}>New IV Registration</Text>
        <Text style={[styles.pageSubtitle, { color: theme.text.secondary }]}>
          Enter a Card ID to auto-fill from the Card Room, or fill in manually.
        </Text>

        {/* Card Room Lookup */}
        <Section theme={theme} icon="card-outline" title="Card Room Lookup" />
        <View style={styles.cardLookupRow}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            placeholder="Enter Card ID / MRN"
            placeholderTextColor={theme.text.muted}
            value={form.card_id}
            onChangeText={(v) => update('card_id', v)}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.lookupBtn, { backgroundColor: theme.accent }]}
            onPress={lookupCard}
            disabled={cardLookupLoading}
          >
            {cardLookupLoading
              ? <ActivityIndicator color={theme.text.inverse} size="small" />
              : <Ionicons name="search" size={18} color={theme.text.inverse} />
            }
          </TouchableOpacity>
        </View>

        {/* Card found confirmation */}
        {cardPatient && (
          <View style={[styles.cardFoundBox, { backgroundColor: theme.status.normalBg, borderColor: theme.status.normalBorder }]}>
            <Ionicons name="checkmark-circle" size={15} color={theme.status.normal} />
            <Text style={[styles.cardFoundText, { color: theme.status.normal }]}>
              Card Room: {cardPatient.patient_name} — fields auto-populated
            </Text>
          </View>
        )}

        {/* Contradiction warnings */}
        {contradictions.length > 0 && (
          <View style={[styles.contradictionBox, { backgroundColor: theme.status.advisoryBg, borderColor: theme.status.advisoryBorder }]}>
            <View style={styles.contradictionHeader}>
              <Ionicons name="warning-outline" size={16} color={theme.status.advisory} />
              <Text style={[styles.contradictionTitle, { color: theme.status.advisory }]}>
                Warning: Configured parameter conflicts with Card Room prescription order
              </Text>
            </View>
            {contradictions.map((c, i) => (
              <Text key={i} style={[styles.contradictionDetail, { color: theme.status.advisory }]}>
                • {c.field}: Prescribed {c.prescribed}, Entered {c.entered} ({c.variance}% variance)
              </Text>
            ))}
          </View>
        )}

        {/* Patient */}
        <Section theme={theme} icon="person-outline" title="Patient Information" />
        <Field theme={theme} label="Patient ID *">
          <TextInput style={inputStyle} placeholder="PAT-001" placeholderTextColor={theme.text.muted}
            value={form.patient_id} onChangeText={(v) => update('patient_id', v)} autoCapitalize="characters" />
        </Field>
        <Field theme={theme} label="Patient Name *">
          <TextInput style={inputStyle} placeholder="Full name" placeholderTextColor={theme.text.muted}
            value={form.patient_name} onChangeText={(v) => update('patient_name', v)} />
        </Field>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Field theme={theme} label="Age">
              <TextInput style={inputStyle} placeholder="e.g. 34" placeholderTextColor={theme.text.muted}
                value={form.age} onChangeText={(v) => update('age', v)} keyboardType="numeric" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field theme={theme} label="Room / Bed *">
              <TextInput style={inputStyle} placeholder="e.g. 3A-02" placeholderTextColor={theme.text.muted}
                value={form.room_bed} onChangeText={(v) => update('room_bed', v)} autoCapitalize="characters" />
            </Field>
          </View>
        </View>

        {/* IV */}
        <Section theme={theme} icon="water-outline" title="IV Line Details" />
        <Field theme={theme} label="IV Line ID *">
          <TextInput style={inputStyle} placeholder="e.g. IV-2024-001" placeholderTextColor={theme.text.muted}
            value={form.iv_id} onChangeText={(v) => update('iv_id', v)} autoCapitalize="characters" />
        </Field>

        <Field theme={theme} label="Fluid Type *">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.optionRow}>
              {FLUID_OPTIONS.map((f) => (
                <TouchableOpacity key={f}
                  style={[styles.optionBtn, { borderColor: form.fluid_name === f ? theme.accent : theme.border, backgroundColor: form.fluid_name === f ? theme.accentMuted : theme.bg.input }]}
                  onPress={() => update('fluid_name', f)}>
                  <Text style={[styles.optionBtnText, { color: form.fluid_name === f ? theme.accent : theme.text.secondary }]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>

        <Field theme={theme} label="Bag Size *">
          <View style={styles.optionRow}>
            {BAG_SIZES.map((s) => (
              <TouchableOpacity key={s}
                style={[styles.optionBtn, { flex: 1, borderColor: form.bag_size_ml === s ? theme.accent : theme.border, backgroundColor: form.bag_size_ml === s ? theme.accentMuted : theme.bg.input }]}
                onPress={() => update('bag_size_ml', s)}>
                <Text style={[styles.optionBtnText, { color: form.bag_size_ml === s ? theme.accent : theme.text.secondary }]}>{s} mL</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>

        <Field theme={theme} label="Prescribed Rate (gtt/min) *">
          <TextInput style={inputStyle} placeholder="e.g. 30" placeholderTextColor={theme.text.muted}
            value={form.prescribed_rate_gtt_min} onChangeText={(v) => update('prescribed_rate_gtt_min', v)} keyboardType="numeric" />
        </Field>

        {/* Sensor */}
        <Section theme={theme} icon="hardware-chip-outline" title="Sensor Assignment" />
        <Field theme={theme} label="Sensor ID *">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.optionRow}>
              {SENSOR_IDS.map((sid) => (
                <TouchableOpacity key={sid}
                  style={[styles.optionBtn, { borderColor: form.sensor_id === sid ? theme.accent : theme.border, backgroundColor: form.sensor_id === sid ? theme.accentMuted : theme.bg.input }]}
                  onPress={() => update('sensor_id', sid)}>
                  <Text style={[styles.optionBtnText, { color: form.sensor_id === sid ? theme.accent : theme.text.secondary }]}>{sid}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: theme.accent }, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color={theme.text.inverse} /> : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={theme.text.inverse} />
              <Text style={[styles.submitText, { color: theme.text.inverse }]}>Register IV Line</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ icon, title, theme }: { icon: string; title: string; theme: any }) {
  return (
    <View style={[styles.sectionRow, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon as any} size={16} color={theme.accent} />
      <Text style={[styles.sectionTitle, { color: theme.text.secondary }]}>{title}</Text>
    </View>
  );
}

function Field({ label, children, theme }: { label: string; children: React.ReactNode; theme: any }) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={[styles.fieldLabel, { color: theme.text.secondary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.sm },
  pageTitle: { fontSize: Typography['2xl'], fontWeight: '800', marginBottom: 4 },
  pageSubtitle: { fontSize: Typography.sm, lineHeight: 20, marginBottom: Spacing.md },
  cardLookupRow: { flexDirection: 'row', gap: Spacing.sm },
  lookupBtn: { paddingHorizontal: Spacing.lg, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center' },
  cardFoundBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.sm, borderWidth: 1 },
  cardFoundText: { fontSize: Typography.sm, flex: 1 },
  contradictionBox: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, gap: 4 },
  contradictionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  contradictionTitle: { fontSize: Typography.sm, fontWeight: '700', flex: 1, lineHeight: 18 },
  contradictionDetail: { fontSize: Typography.xs, marginLeft: Spacing.lg },
  twoCol: { flexDirection: 'row', gap: Spacing.md },
  input: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.base },
  optionRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  optionBtn: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center' },
  optionBtnText: { fontSize: Typography.sm, fontWeight: '600' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, paddingVertical: Spacing.lg, gap: Spacing.sm, marginTop: Spacing.lg },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { fontSize: Typography.md, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: 4, borderBottomWidth: 1, paddingBottom: Spacing.sm },
  sectionTitle: { fontSize: Typography.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldContainer: { gap: 6 },
  fieldLabel: { fontSize: Typography.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
});
