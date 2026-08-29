export const BASE_URL = "http://localhost:8000";
export const WS_URL  = "ws://localhost:8000/ws/telemetry";

export const API = {
  TELEMETRY:   `${BASE_URL}/api/telemetry`,
  REGISTER:    `${BASE_URL}/api/iv/register`,
  ACKNOWLEDGE: `${BASE_URL}/api/iv/acknowledge`,
  NEW_BAG:     `${BASE_URL}/api/iv/new-bag`,
  LIST_IVS:    `${BASE_URL}/api/iv/list`,
  HISTORY:     (ivId: string) => `${BASE_URL}/api/iv/history/${ivId}`,

  // Auth
  LOGIN:       `${BASE_URL}/api/auth/login`,
  LOGOUT:      `${BASE_URL}/api/auth/logout`,
  ME:          `${BASE_URL}/api/auth/me`,

  // Card Room
  PATIENT:     (cardId: string) => `${BASE_URL}/api/patients/${cardId}`,
  PATIENTS:    `${BASE_URL}/api/patients`,

  // ESP32 Node
  NODE_TELEMETRY: `${BASE_URL}/api/node/telemetry`,
  NODE_CONFIG:    (bedId: string) => `${BASE_URL}/api/node/config/${bedId}`,
  LIVE_STATUS:    `${BASE_URL}/api/beds/live-status`,
};
