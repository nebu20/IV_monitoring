/**
 * Shared TypeScript types mirroring backend Pydantic schemas.
 */

export type FlowStatus =
  | 'NORMAL'
  | 'ADVISORY'
  | 'CRITICAL'
  | 'HIGH_PRIORITY'
  | 'ANOMALY';

export type AlarmPriority = 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL';

export interface TelemetryState {
  sensor_id: string;
  iv_id: string;
  patient_name: string;
  room_bed: string;
  fluid_name: string;
  bag_size_ml: number;
  volume_ml: number;
  percentage: number;
  drip_rate_gtt_min: number;
  raw_weight_grams: number;
  flow_status: FlowStatus;
  alarm_priority: AlarmPriority;
  eta_string: string;
  alarm_acknowledged: boolean;
  last_update: string;   // ISO-8601
  prescribed_rate_gtt_min: number;
  // Device status — only present when sent via /api/node/telemetry (ESP32)
  battery_level?: number;    // 0-100
  power_source?: string;     // "AC_GRID" | "BATTERY"
  node_status?: string;      // "OK" | "ERROR" | "CALIBRATING"
}

export interface NodeAlert {
  type: string;       // "POWER_SOURCE" | "LOW_BATTERY" | "NODE_ERROR"
  message: string;
  severity: string;   // "WARNING" | "CRITICAL" | "HIGH"
}

export interface IVRegisterRequest {
  patient_id: string;
  patient_name: string;
  room_bed: string;
  iv_id: string;
  fluid_name: string;
  bag_size_ml: number;
  prescribed_rate_gtt_min: number;
  sensor_id: string;
}

export interface AcknowledgeRequest {
  iv_id: string;
  nurse_notes?: string;
}

export interface NewBagRequest {
  iv_id: string;
  new_bag_size_ml: number;
  nurse_notes?: string;
}

export interface TelemetryHistory {
  metadata: {
    iv_id: string;
    patient_name: string;
    room_bed: string;
    fluid_name: string;
    bag_size_ml: number;
    prescribed_rate_gtt_min: number;
    sensor_id: string;
  };
  telemetry_logs: {
    timestamp: string;
    volume_ml: number;
    percentage: number;
    drip_rate_gtt_min: number;
    flow_status: FlowStatus;
    alarm_priority: AlarmPriority;
    eta_string: string;
    raw_weight_grams: number;
  }[];
  events: {
    event_type: string;
    timestamp: string;
    nurse_notes?: string;
  }[];
}

// WebSocket message envelopes
export type WSMessage =
  | { type: 'INITIAL_STATE'; data: TelemetryState[] }
  | { type: 'TELEMETRY_UPDATE'; data: TelemetryState }
  | { type: 'ALARM_ACKNOWLEDGED'; data: { iv_id: string; sensor_id: string } }
  | { type: 'BAG_REPLACED'; data: { iv_id: string; new_bag_size_ml: number } }
  | { type: 'IV_REGISTERED'; data: { iv_id: string; sensor_id: string; patient_name: string } }
  | { type: 'SESSION_ENDED'; data: { iv_id: string; room_bed: string; sensor_id: string } }
  | { type: 'NODE_ALERTS'; bedId: string; alerts: NodeAlert[] }
  | { type: 'PONG' };

// ── Medication Reminder System ────────────────────────────────────────────────

export type DoseStatus = 'PENDING' | 'GIVEN' | 'DELAYED' | 'REFUSED' | 'NOT_GIVEN';
export type DueStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'GIVEN' | 'DELAYED' | 'REFUSED' | 'NOT_GIVEN';

export interface MedicationSchedule {
  id: number;
  card_id: string;
  patient_name?: string;
  room_bed?: string;
  medication_name: string;
  dose: string;
  route: string;
  frequency: string;
  scheduled_times: string[];
  start_date: string;
  end_date?: string;
  instructions?: string;
  active: boolean;
  created_by?: string;
  created_at?: string;
}

export interface DueDose {
  schedule_id: number;
  dose_id: number | null;
  scheduled_datetime: string;
  status: DueStatus;
  medication_name: string;
  dose: string;
  route: string;
  card_id: string;
  patient_name: string | null;
  room_bed: string | null;
  acknowledged: boolean;
  administered_by: string | null;
  administered_at: string | null;
  reason: string | null;
  notes: string | null;
}

export interface DoseHistoryEntry {
  schedule_id: number;
  dose_id: number;
  medication_name: string;
  dose: string;
  route: string;
  scheduled_datetime: string;
  status: DoseStatus;
  administered_by: string | null;
  administered_at: string | null;
  reason: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}
