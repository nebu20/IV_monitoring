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
  | { type: 'PONG' };
