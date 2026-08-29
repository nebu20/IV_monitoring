/**
 * Start IV Session — Nurse Workflow
 * ===================================
 * Card Room API is the ONLY source of patient/prescription data.
 * Nurse can only select: Bed ID and Sensor ID.
 * All clinical metadata is locked once Card ID is looked up.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { BASE_URL, API } from '../constants/config';
import { Typography, Spacing, Radius } from '../constants/theme';

const SENSOR_IDS = ['SENS-101', 'SENS-102', 'SENS-103', 'SENS-104', 'SENS-105', 'SENS-106'];

interface CardPatient {
  card_id: string;
  patient_name: string;
  age?: number;
  prescribed_fluid?: string;
  target_volume_ml?: number;
  target_drop_rate?: number;
  ward?: string;
  attending_doctor?: string;
}

export default function StartIVScreen() {
  const { theme } = useTheme();
  const { user } = useAuthStore();

  const [cardId, setCardId] = useState('');
  const [bedId, setBedId] = useState('');
  const [sensorId, setSensorId] = useState('SENS-101');
  const [patient, setPatient] = useState<CardPatient | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<string[]>([]);
  const [occupiedBeds, setOccupiedBeds] = useState<string[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);

  const assignedBeds = user?.assigned_beds ?? [];

  // Load available beds on mount
  useEffect(() => {
    const load = async () => {
      setBedsLoading(true);
      try {
        const res = await fetch(`${BASE_URL}/api/iv/available-beds`, {
          headers: { Authorization: `Bearer ${user?.token ?? ''}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAvailableBeds(data.available_beds ?? []);
          setOccupiedBeds(data.occupied_beds ?? []);
        }
      } catch { }
      setBedsLoading(false);
    };
    load();
  }, []);

  // ── Ward mismatch detection ───────────────────────────────────────────────
  const extractWard = (bed: string) => bed.split('-')[0] ?? bed;

  const wardMismatch = (() => {
    if (!patient?.ward || !bedId.trim()) return null;
    const patientWard = patient.ward.trim().toUpperCase();
    const bedWard = extractWard(bedId.trim()).toUpperCase();
    if (patientWard !== bedWard) {
      return `Patient is registered for Ward ${patient.ward}, but bed '${bedId}' is in Ward ${extractWard(bedId)}. Select a Ward ${patient.ward} bed or transfer the patient record.`;
    }
    return null;
  })();

  const lookupCard = async () => {
    if (!cardId.trim()) return;
    setLookupLoading(true);
    setPatient(null);
    try {
      const res = await fetch(`${BASE_URL}/api/patients/${cardId.trim()}`, {
        headers: { Authorization: `Bearer ${user?.token ?? ''}` },
      });
      if (res.ok) {
        setPatient(await res.json());
      } else {
        Alert.alert(
          'Patient Not Found',
          `No Card Room record for ID: ${cardId}\n\nAsk the Admin to register this patient in the Card Room first.`
        );
      }
    } catch {
      Alert.alert('Error', 'Cannot reach server. Check your connection.');
    } finally {
      setLookupLoading(false);
    }
  };

  const startSession = async () => {
    if (!patient) return;
    if (!bedId.trim()) { Alert.alert('Required', 'Please select a bed first.'); return; }

    setSubmitting(true);
    try {
      const ivId = `IV-${patient.card_id}-${Date.now().toString().slice(-6)}`;
      const res = await fetch(API.REGISTER, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user?.token ?? ''}`,
        },
        body: JSON.stringify({
          patient_id: patient.card_id,
          patient_name: patient.patient_name,
          room_bed: bedId.trim(),
          iv_id: ivId,
          fluid_name: patient.prescribed_fluid ?? 'NS 0.9%',
          bag_size_ml: patient.target_volume_ml ?? 500,
          prescribed_rate_gtt_min: patient.target_drop_rate ?? 30,
          sensor_id: sensorId,
          card_id: patient.card_id,
        }),
      });

      if (res.ok) {
        Alert.alert(
          '✅ IV Session Started',
          `${patient.patient_name} is registered on Bed ${bedId}.\n\nAttach sensor ${sensorId} to the IV stand. The monitoring card will appear on the dashboard after the first sensor reading.`,
          [{ text: 'Go to Dashboard', onPress: () => router.replace('/') }]
        );

        Alert.alert(
          '✅ IV Session Started',
          `${patient.patient_name} is now being monitored on Bed ${bedId}.\n\nAttach sensor ${sensorId} to the IV line to begin live tracking.`,
          [{ text: 'Go to Dashboard', onPress: () => router.replace('/') }]
        );
      } else {
        const e = await res.json();
        Alert.alert('Error', e.detail ?? 'Could not start session');
      }
    } catch {
      Alert.alert('Error', 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [styles.input, {
    backgroundColor: theme.bg.input,
    borderColor: theme.border,
    color: theme.text.primary,
  }];

  // Bug 2: Block occupied beds + ward mismatch
  const bedIsOccupied = bedId.trim() ? occupiedBeds.includes(bedId.trim()) : false;
  const canStart = !!patient && !!bedId.trim() && !wardMismatch && !bedIsOccupied;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg.primary }]} edges={['bottom', 'left', 'right']}>

      {/* Nav bar */}
      <View style={[styles.navBar, { backgroundColor: theme.bg.secondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-circle" size={22} color={theme.accent} />
          <Text style={[styles.backText, { color: theme.accent }]}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: theme.text.primary }]}>Start IV Session</Text>
        <View style={{ width: 90 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Step 1: Scan Card ID ── */}
        <StepHeader theme={theme} step="1" title="Scan / Enter Patient Card ID" />
        <Text style={[styles.stepHint, { color: theme.text.muted }]}>
          All prescription data is loaded automatically from the Card Room.
        </Text>

        <View style={styles.scanRow}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            placeholder="Card ID / MRN (e.g. MRN-10042)"
            placeholderTextColor={theme.text.muted}
            value={cardId}
            onChangeText={(v) => { setCardId(v); setPatient(null); }}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.lookupBtn, { backgroundColor: theme.accent }]}
            onPress={lookupCard}
            disabled={lookupLoading || !cardId.trim()}
          >
            {lookupLoading
              ? <ActivityIndicator color={theme.text.inverse} size="small" />
              : <><Ionicons name="search" size={16} color={theme.text.inverse} />
                <Text style={[styles.lookupBtnText, { color: theme.text.inverse }]}>Lookup</Text></>
            }
          </TouchableOpacity>
        </View>

        {/* ── Locked Prescription Data ── */}
        {patient && (
          <View style={[styles.prescriptionCard, { backgroundColor: theme.bg.card, borderColor: theme.status.normalBorder }]}>

            {/* Header */}
            <View style={styles.prescriptionHeader}>
              <Ionicons name="lock-closed" size={16} color={theme.status.normal} />
              <Text style={[styles.prescriptionHeaderText, { color: theme.status.normal }]}>
                Card Room Prescription — Locked
              </Text>
            </View>

            {/* Patient identity */}
            <View style={[styles.patientIdentity, { backgroundColor: theme.bg.input, borderRadius: Radius.sm }]}>
              <View style={styles.identityRow}>
                <Ionicons name="person-circle-outline" size={32} color={theme.accent} />
                <View>
                  <Text style={[styles.patientName, { color: theme.text.primary }]}>{patient.patient_name}</Text>
                  <Text style={[styles.patientMeta, { color: theme.text.secondary }]}>
                    Card ID: {patient.card_id}{patient.age ? ` · Age: ${patient.age}` : ''}{patient.ward ? ` · ${patient.ward}` : ''}
                  </Text>
                  {patient.attending_doctor && (
                    <Text style={[styles.patientMeta, { color: theme.text.muted }]}>
                      Dr. {patient.attending_doctor}
                    </Text>
                  )}
                </View>
              </View>
            </View>

            {/* Prescription values — READ ONLY */}
            <Text style={[styles.rxTitle, { color: theme.text.secondary }]}>Prescription Order</Text>
            <View style={styles.rxGrid}>
              <RxField
                theme={theme}
                icon="water-outline"
                label="Fluid Type"
                value={patient.prescribed_fluid ?? 'Not specified'}
              />
              <RxField
                theme={theme}
                icon="beaker-outline"
                label="Target Volume"
                value={patient.target_volume_ml ? `${patient.target_volume_ml} mL` : 'Not specified'}
              />
              <RxField
                theme={theme}
                icon="speedometer-outline"
                label="Prescribed Rate"
                value={patient.target_drop_rate ? `${patient.target_drop_rate} drops/min` : 'Not specified'}
              />
            </View>

            <View style={[styles.lockNotice, { backgroundColor: theme.status.normalBg }]}>
              <Ionicons name="information-circle-outline" size={14} color={theme.status.normal} />
              <Text style={[styles.lockNoticeText, { color: theme.status.normal }]}>
                These values are set by the Card Room and cannot be modified. Contact the prescribing doctor to change orders.
              </Text>
            </View>
          </View>
        )}

        {/* ── Step 2: Select Bed ── */}
        {patient && (
          <>
            <StepHeader theme={theme} step="2" title="Select Available Bed" />
            {bedsLoading ? (
              <ActivityIndicator color={theme.accent} />
            ) : availableBeds.length === 0 && occupiedBeds.length === 0 ? (
              <View style={[styles.wardMismatchBox, { backgroundColor: theme.status.advisoryBg, borderColor: theme.status.advisoryBorder }]}>
                <Ionicons name="information-circle-outline" size={18} color={theme.status.advisory} />
                <Text style={[styles.wardMismatchText, { color: theme.status.advisory, flex: 1 }]}>
                  No beds assigned to your account. Contact Admin to assign beds.
                </Text>
              </View>
            ) : (
              <>
                {availableBeds.length > 0 && (
                  <>
                    <Text style={[styles.bedGroupLabel, { color: theme.status.normal }]}>
                      ✅ Available Beds
                    </Text>
                    <View style={styles.bedRow}>
                      {availableBeds.map((bed) => (
                        <TouchableOpacity
                          key={bed}
                          style={[styles.bedBtn, {
                            borderColor: bedId === bed ? theme.accent : theme.status.normalBorder,
                            backgroundColor: bedId === bed ? theme.accentMuted : theme.status.normalBg,
                          }]}
                          onPress={() => setBedId(bed)}
                        >
                          <Ionicons name="bed-outline" size={13} color={bedId === bed ? theme.accent : theme.status.normal} />
                          <Text style={[styles.bedBtnText, { color: bedId === bed ? theme.accent : theme.status.normal }]}>{bed}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                {occupiedBeds.length > 0 && (
                  <>
                    <Text style={[styles.bedGroupLabel, { color: theme.status.critical }]}>
                      🔴 Occupied Beds (unavailable)
                    </Text>
                    <View style={styles.bedRow}>
                      {occupiedBeds.map((bed) => (
                        <View
                          key={bed}
                          style={[styles.bedBtn, {
                            borderColor: theme.status.criticalBorder,
                            backgroundColor: theme.status.criticalBg,
                            opacity: 0.5,
                          }]}
                        >
                          <Ionicons name="lock-closed" size={13} color={theme.status.critical} />
                          <Text style={[styles.bedBtnText, { color: theme.status.critical }]}>{bed}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
            <TextInput
              style={inputStyle}
              placeholder="Or type a custom Bed ID"
              placeholderTextColor={theme.text.muted}
              value={bedId}
              onChangeText={setBedId}
              autoCapitalize="characters"
            />

            {/* ── Occupied Bed Warning ── */}
            {bedIsOccupied && (
              <View style={[styles.wardMismatchBox, { backgroundColor: theme.status.criticalBg, borderColor: theme.status.criticalBorder }]}>
                <Ionicons name="lock-closed" size={18} color={theme.status.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.wardMismatchTitle, { color: theme.status.critical }]}>
                    🔴 Bed Occupied
                  </Text>
                  <Text style={[styles.wardMismatchText, { color: theme.status.critical }]}>
                    Bed '{bedId}' is currently ACTIVE with another patient. Select an available (green) bed.
                  </Text>
                </View>
              </View>
            )}

            {/* ── Ward Mismatch Warning ── */}
            {wardMismatch && (
              <View style={[styles.wardMismatchBox, { backgroundColor: theme.status.criticalBg, borderColor: theme.status.criticalBorder }]}>
                <Ionicons name="warning" size={18} color={theme.status.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.wardMismatchTitle, { color: theme.status.critical }]}>
                    ⚠️ Ward Mismatch
                  </Text>
                  <Text style={[styles.wardMismatchText, { color: theme.status.critical }]}>
                    {wardMismatch}
                  </Text>
                </View>
              </View>
            )}

            {/* ── Step 3: Assign Sensor ── */}
            <StepHeader theme={theme} step="3" title="Assign Physical Sensor" />
            <Text style={[styles.stepHint, { color: theme.text.muted }]}>
              Select the Sensor ID printed on the device clipped to this IV stand.
            </Text>
            <View style={styles.sensorGrid}>
              {SENSOR_IDS.map((sid) => (
                <TouchableOpacity
                  key={sid}
                  style={[styles.sensorBtn, {
                    borderColor: sensorId === sid ? theme.accent : theme.border,
                    backgroundColor: sensorId === sid ? theme.accentMuted : theme.bg.input,
                  }]}
                  onPress={() => setSensorId(sid)}
                >
                  <Ionicons name="hardware-chip-outline" size={13} color={sensorId === sid ? theme.accent : theme.text.secondary} />
                  <Text style={[styles.sensorBtnText, { color: sensorId === sid ? theme.accent : theme.text.secondary }]}>{sid}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Confirm ── */}
            <TouchableOpacity
              style={[
                styles.startBtn,
                { backgroundColor: canStart ? theme.status.normal : theme.bg.input },
                !canStart && styles.startBtnDisabled,
              ]}
              onPress={startSession}
              disabled={!canStart || submitting}
            >
              {submitting ? (
                <ActivityIndicator color={theme.text.inverse} />
              ) : (
                <>
                  <Ionicons
                    name={bedIsOccupied ? 'lock-closed' : wardMismatch ? 'close-circle' : canStart ? 'play-circle' : 'lock-closed-outline'}
                    size={22}
                    color={canStart ? theme.text.inverse : wardMismatch || bedIsOccupied ? theme.status.critical : theme.text.muted}
                  />
                  <Text style={[styles.startBtnText, {
                    color: canStart ? theme.text.inverse : wardMismatch || bedIsOccupied ? theme.status.critical : theme.text.muted,
                  }]}>
                    {bedIsOccupied
                      ? 'Bed Occupied — Select Another'
                      : wardMismatch
                      ? 'Ward Mismatch — Cannot Start'
                      : canStart
                      ? 'Start IV Monitoring'
                      : 'Scan Card ID & Select Bed First'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* Placeholder when no card scanned */}
        {!patient && !lookupLoading && (
          <View style={[styles.emptyHint, { borderColor: theme.border, backgroundColor: theme.bg.secondary }]}>
            <Ionicons name="card-outline" size={36} color={theme.text.muted} />
            <Text style={[styles.emptyHintTitle, { color: theme.text.secondary }]}>No Patient Scanned</Text>
            <Text style={[styles.emptyHintText, { color: theme.text.muted }]}>
              Enter the patient's Card ID above and tap Lookup to load their prescription from the Card Room.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepHeader({ step, title, theme }: { step: string; title: string; theme: any }) {
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepBadge, { backgroundColor: theme.accent }]}>
        <Text style={[styles.stepNum, { color: theme.text.inverse }]}>{step}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: theme.text.primary }]}>{title}</Text>
    </View>
  );
}

function RxField({ icon, label, value, theme }: { icon: string; label: string; value: string; theme: any }) {
  return (
    <View style={[styles.rxField, { backgroundColor: theme.bg.input, borderColor: theme.border }]}>
      <View style={styles.rxFieldHeader}>
        <Ionicons name={icon as any} size={13} color={theme.text.muted} />
        <Text style={[styles.rxFieldLabel, { color: theme.text.muted }]}>{label}</Text>
        <Ionicons name="lock-closed" size={10} color={theme.text.muted} />
      </View>
      <Text style={[styles.rxFieldValue, { color: theme.text.primary }]}>{value}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 90 },
  backText: { fontSize: Typography.sm, fontWeight: '600' },
  navTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', textAlign: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'], gap: Spacing.md },

  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  stepBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  stepNum: { fontSize: Typography.sm, fontWeight: '800' },
  stepTitle: { fontSize: Typography.md, fontWeight: '700' },
  stepHint: { fontSize: Typography.xs, lineHeight: 18, marginTop: -Spacing.sm },

  scanRow: { flexDirection: 'row', gap: Spacing.sm },
  lookupBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.lg, borderRadius: Radius.md, justifyContent: 'center' },
  lookupBtnText: { fontSize: Typography.sm, fontWeight: '700' },
  input: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2, fontSize: Typography.base },

  prescriptionCard: { borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1.5, gap: Spacing.md },
  prescriptionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  prescriptionHeaderText: { fontSize: Typography.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  patientIdentity: { padding: Spacing.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  patientName: { fontSize: Typography.lg, fontWeight: '800' },
  patientMeta: { fontSize: Typography.xs, marginTop: 2 },
  rxTitle: { fontSize: Typography.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  rxGrid: { gap: Spacing.sm },
  rxField: { borderRadius: Radius.sm, padding: Spacing.md, borderWidth: 1, gap: 4 },
  rxFieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rxFieldLabel: { fontSize: Typography.xs, flex: 1 },
  rxFieldValue: { fontSize: Typography.md, fontWeight: '700' },
  lockNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.sm },
  lockNoticeText: { fontSize: Typography.xs, flex: 1, lineHeight: 16 },

  bedGroupLabel: { fontSize: Typography.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  bedRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  bedBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1 },
  bedBtnText: { fontSize: Typography.sm, fontWeight: '600' },

  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  sensorBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1 },
  sensorBtnText: { fontSize: Typography.sm, fontWeight: '600' },

  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.lg + 4, borderRadius: Radius.md, gap: Spacing.sm, marginTop: Spacing.sm },
  startBtnDisabled: { opacity: 0.7 },
  startBtnText: { fontSize: Typography.lg, fontWeight: '800' },

  wardMismatchBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5,
  },
  wardMismatchTitle: { fontSize: Typography.sm, fontWeight: '800', marginBottom: 2 },
  wardMismatchText: { fontSize: Typography.xs, lineHeight: 17 },

  emptyHint: { alignItems: 'center', gap: Spacing.sm, padding: Spacing['2xl'], borderRadius: Radius.lg, borderWidth: 1, borderStyle: 'dashed', marginTop: Spacing.xl },
  emptyHintTitle: { fontSize: Typography.md, fontWeight: '700' },
  emptyHintText: { fontSize: Typography.sm, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});
