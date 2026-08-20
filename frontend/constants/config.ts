/**
 * Central configuration — update BASE_URL to match your backend host.
 * For local dev with Expo Go on a real device, replace localhost with
 * your machine's LAN IP address (e.g., 192.168.1.100).
 */

export const BASE_URL = "http://localhost:8000";
export const WS_URL  = "ws://localhost:8000/ws/telemetry";

export const API = {
  TELEMETRY:   `${BASE_URL}/api/telemetry`,
  REGISTER:    `${BASE_URL}/api/iv/register`,
  ACKNOWLEDGE: `${BASE_URL}/api/iv/acknowledge`,
  NEW_BAG:     `${BASE_URL}/api/iv/new-bag`,
  LIST_IVS:    `${BASE_URL}/api/iv/list`,
  HISTORY:     (ivId: string) => `${BASE_URL}/api/iv/history/${ivId}`,
};
