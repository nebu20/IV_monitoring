import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { DueDose, DueStatus } from '../types';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing, Radius } from '../constants/theme';

interface Props {
  dose: DueDose;
  /** Returns true on success, false on failure. */
  onAdminister: (
    doseId: number, status: string, reason?: string, notes?: string
  ) => Promise<boolean>;
  /** Returns true on success, false on failure. */
  onAcknowledge: (doseId: number) => Promise<boolean>;
  /** Creates a dose record if needed; returns the dose_id or null on error. */
  onEnsureDose: (
    scheduleId: number, scheduledDatetimeUtc: string
  ) => Promise<number | null>;
}

const STATUS_CONFIG: Record<DueStatus, {
  label: string; color: string; bg: string; icon: string;
}> = {
  OVERDUE:   { label: 'Overdue',   color: 'critical',  bg: 'criticalBg',  icon: 'alert-circle-outline' },
  DUE:       { label: 'Due Now',   color: 'advisory',  bg: 'advisoryBg',  icon: 'time-outline' },
  UPCOMING:  { label: 'Upcoming',  color: 'normal',    bg: 'normalBg',    icon: 'hourglass-outline' },
  GIVEN:     { label: 'Given',     color: 'normal',    bg: 'normalBg',    icon: 'checkmark-circle-outline' },
  DELAYED:   { label: 'Delayed',   color: 'advisory',  bg: 'advisoryBg',  icon: 'timer-outline' },
  REFUSED:   { label: 'Refused',   color: 'critical',  bg: 'criticalBg',  icon: 'close-circle-outline' },
  NOT_GIVEN: { label: 'Not Given', color: 'critical',  bg: 'criticalBg',  icon: 'close-circle-outline' },
};

type ModalMode = 'record' | 'ack' | null;

export function MedicationCard({
  dose, onAdminister, onAcknowledge, onEnsureDose,
}: Props) {
  const { theme } = useTheme();

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [adminStatus, setAdminStatus] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const cfg = STATUS_CONFIG[dose.status] ?? STATUS_CONFIG.UPCOMING;
  const statusColor = (theme.status as any)[cfg.color] as string;
  const statusBg = (theme.status as any)[cfg.bg] as string;

  const isActionable = dose.status === 'OVERDUE' || dose.status === 'DUE' || dose.status === 'UPCOMING';
  const hasTerminal = ['GIVEN', 'DELAYED', 'REFUSED', 'NOT_GIVEN'].includes(dose.status);

  const scheduledTime = (() => {
    try { return format(new Date(dose.scheduled_datetime), 'HH:mm'); }
    catch { return '—'; }
  })();

  const closeModal = () => {
    if (submitting) return;
    setModalMode(null);
    setAdminStatus('');
    setReason('');
    setActionError(null);
  };

  /** Resolve an existing dose_id or create a new DoseRecord for this slot. */
  const resolveDoseId = async (): Promise<number> => {
    if (dose.dose_id != null) return dose.dose_id;
    const utcKey = (dose as any).scheduled_datetime_utc ?? dose.scheduled_datetime;
    const newId = await onEnsureDose(dose.schedule_id, utcKey);
    if (newId == null) {
      throw new Error('Could not create dose record. Check your connection.');
    }
    return newId;
  };

  const handleRecord = async () => {
    if (!adminStatus) return;
    const needsReason =
      adminStatus === 'DELAYED' || adminStatus === 'REFUSED' || adminStatus === 'NOT_GIVEN';
    if (needsReason && !reason.trim()) {
      setActionError(`A reason is required for "${adminStatus.replace('_', ' ')}".`);
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      const doseId = await resolveDoseId();
      const ok = await onAdminister(doseId, adminStatus, reason.trim() || undefined);
      if (ok) {
        setModalMode(null);
        setAdminStatus('');
        setReason('');
      } else {
        setActionError('Failed to record. The dose may have already been recorded.');
      }
    } catch (e: any) {
      setActionError(e?.message ?? 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAck = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      const doseId = await resolveDoseId();
      const ok = await onAcknowledge(doseId);
      if (ok) {
        setModalMode(null);
      } else {
        setActionError('Already acknowledged or could not connect to server.');
      }
    } catch (e: any) {
      setActionError(e?.message ?? 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.card, {
      backgroundColor: theme.bg.card,
      borderColor: theme.border,
      borderTopColor: statusColor,
    }]}>
      {/* Row 1: time + status label + ack dot */}
      <View style={styles.row1}>
        <View style={[styles.timePill, { backgroundColor: statusBg }]}>
          <Ionicons name={cfg.icon as any} size={11} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>{scheduledTime}</Text>
        </View>
        <Text style={[styles.statusBadge, { color: statusColor }]}>{cfg.label}</Text>
        {dose.acknowledged && !hasTerminal && (
          <View style={[styles.ackDot, { backgroundColor: theme.status.normal }]} />
        )}
      </View>

      {/* Medication info */}
      <Text style={[styles.medName, { color: theme.text.primary }]} numberOfLines={1}>
        {dose.medication_name} — {dose.dose}
      </Text>
      <View style={styles.infoRow}>
        <Text style={[styles.infoText, { color: theme.text.secondary }]}>
          {dose.patient_name ?? dose.card_id} · {dose.room_bed ?? 'No bed'}
        </Text>
        <Text style={[styles.routeText, { color: theme.text.muted }]}>{dose.route}</Text>
      </View>

      {/* Terminal outcome info */}
      {hasTerminal && dose.administered_by && (
        <Text style={[styles.adminText, { color: theme.text.muted }]}>
          {dose.status.replace('_', ' ')} by {dose.administered_by}
          {dose.reason ? ` · ${dose.reason}` : ''}
        </Text>
      )}

      {/* Action buttons */}
      {isActionable && !hasTerminal && (
        <View style={styles.actionsRow}>
          {!dose.acknowledged && (
            <TouchableOpacity
              style={[styles.btn, {
                borderColor: theme.status.advisoryBorder,
                backgroundColor: theme.status.advisoryBg,
              }]}
              onPress={() => { setActionError(null); setModalMode('ack'); }}
            >
              <Ionicons name="notifications-outline" size={13} color={theme.status.advisory} />
              <Text style={[styles.btnText, { color: theme.status.advisory }]}>Acknowledge</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btn, {
              borderColor: theme.status.normalBorder,
              backgroundColor: theme.status.normalBg,
            }]}
            onPress={() => { setAdminStatus('GIVEN'); setReason(''); setActionError(null); setModalMode('record'); }}
          >
            <Ionicons name="checkmark-circle-outline" size={13} color={theme.status.normal} />
            <Text style={[styles.btnText, { color: theme.status.normal }]}>Record Outcome</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Acknowledge modal ── */}
      <Modal
        visible={modalMode === 'ack'}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: theme.bg.modal }]}>
            <Text style={[styles.modalTitle, { color: theme.text.primary }]}>
              Acknowledge Reminder
            </Text>
            <Text style={[styles.modalBody, { color: theme.text.secondary }]}>
              Acknowledging silences the alert.{'\n'}
              It does <Text style={{ fontWeight: '800' }}>not</Text> record that
              the medication was given. Use "Record Outcome" to document administration.
            </Text>
            <Text style={[styles.modalMed, { color: theme.accent }]}>
              {dose.medication_name} — {dose.dose} at {scheduledTime}
            </Text>
            {actionError != null && (
              <Text style={[styles.errorText, { color: theme.status.critical }]}>
                {actionError}
              </Text>
            )}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: theme.border }]}
                onPress={closeModal}
                disabled={submitting}
              >
                <Text style={[styles.modalBtnText, { color: theme.text.secondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: theme.status.advisory },
                  submitting && styles.dimmed,
                ]}
                onPress={handleAck}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={theme.text.inverse} size="small" />
                  : <Text style={[styles.modalBtnText, { color: theme.text.inverse }]}>
                      Acknowledge
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Record Outcome modal ── */}
      <Modal
        visible={modalMode === 'record'}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: theme.bg.modal }]}>
            <Text style={[styles.modalTitle, { color: theme.text.primary }]}>
              Record Outcome
            </Text>
            <Text style={[styles.modalMed, { color: theme.text.secondary }]}>
              {dose.medication_name} — {dose.dose} ({dose.route}) at {scheduledTime}
            </Text>

            <View style={styles.statusGrid}>
              {(['GIVEN', 'DELAYED', 'REFUSED', 'NOT_GIVEN'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, {
                    borderColor: adminStatus === s ? theme.accent : theme.border,
                    backgroundColor: adminStatus === s ? theme.accentMuted : theme.bg.input,
                  }]}
                  onPress={() => { setAdminStatus(s); setActionError(null); }}
                  disabled={submitting}
                >
                  <Text style={[styles.statusBtnText, {
                    color: adminStatus === s ? theme.accent : theme.text.secondary,
                  }]}>
                    {s.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {(adminStatus === 'DELAYED' || adminStatus === 'REFUSED' || adminStatus === 'NOT_GIVEN') && (
              <TextInput
                style={[styles.reasonInput, {
                  backgroundColor: theme.bg.input,
                  borderColor: actionError ? theme.status.critical : theme.border,
                  color: theme.text.primary,
                }]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.text.muted}
                value={reason}
                onChangeText={(v) => { setReason(v); setActionError(null); }}
                multiline
                editable={!submitting}
              />
            )}

            {actionError != null && (
              <Text style={[styles.errorText, { color: theme.status.critical }]}>
                {actionError}
              </Text>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: theme.border }]}
                onPress={closeModal}
                disabled={submitting}
              >
                <Text style={[styles.modalBtnText, { color: theme.text.secondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: adminStatus ? theme.accent : theme.bg.input },
                  (!adminStatus || submitting) && styles.dimmed,
                ]}
                onPress={handleRecord}
                disabled={!adminStatus || submitting}
              >
                {submitting
                  ? <ActivityIndicator color={theme.text.inverse} size="small" />
                  : <Text style={[styles.modalBtnText, {
                      color: adminStatus ? theme.text.inverse : theme.text.muted,
                    }]}>
                      Confirm
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md, borderWidth: 1, borderTopWidth: 3,
    padding: Spacing.md, gap: 6,
  },
  row1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timePill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm, gap: 3,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { fontSize: 11, fontWeight: '700', flex: 1, textTransform: 'uppercase' },
  ackDot: { width: 7, height: 7, borderRadius: 4 },
  medName: { fontSize: Typography.base, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoText: { fontSize: 11, flex: 1 },
  routeText: { fontSize: 11, fontWeight: '600' },
  adminText: { fontSize: 10, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 2 },
  btn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Radius.sm, borderWidth: 1, gap: 3,
  },
  btnText: { fontSize: 11, fontWeight: '600' },
  overlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modal: {
    borderRadius: Radius.lg, padding: Spacing.xl,
    width: '88%', maxWidth: 420, gap: Spacing.md,
  },
  modalTitle: { fontSize: Typography.lg, fontWeight: '800' },
  modalBody: { fontSize: Typography.sm, lineHeight: 20 },
  modalMed: { fontSize: Typography.sm, fontWeight: '600' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statusBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.md, borderWidth: 1,
  },
  statusBtnText: { fontSize: Typography.sm, fontWeight: '600' },
  reasonInput: {
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.sm, minHeight: 60,
  },
  errorText: { fontSize: Typography.xs, fontWeight: '600' },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  modalBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1,
    minWidth: 90, alignItems: 'center', justifyContent: 'center', minHeight: 38,
  },
  modalBtnText: { fontSize: Typography.base, fontWeight: '700' },
  dimmed: { opacity: 0.55 },
});
