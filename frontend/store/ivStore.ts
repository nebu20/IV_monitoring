/**
 * Zustand store for IV telemetry state.
 * Manages the live map of all IV states, WebSocket lifecycle,
 * alarm acknowledgement, and filter/sort controls.
 */

import { create } from 'zustand';
import { TelemetryState, WSMessage, FlowStatus, AlarmPriority } from '../types';
import { WS_URL, API } from '../constants/config';

export type SortMode = 'urgency' | 'eta' | 'room';
export type FilterMode = 'all' | 'low_volume' | 'no_flow' | 'offline' | 'search';

interface IVStore {
  // Live state map: sensor_id → TelemetryState
  ivMap: Record<string, TelemetryState>;

  // WebSocket
  wsConnected: boolean;
  wsRetryCount: number;

  // UI state
  sortMode: SortMode;
  filterMode: FilterMode;
  searchQuery: string;
  selectedIvId: string | null;

  // New-bag detection modal
  newBagModalVisible: boolean;
  newBagIvId: string | null;
  prevWeightMap: Record<string, number>;

  // Actions
  setSortMode: (m: SortMode) => void;
  setFilterMode: (m: FilterMode) => void;
  setSearchQuery: (q: string) => void;
  setSelectedIvId: (id: string | null) => void;
  dismissNewBagModal: () => void;
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  acknowledgeAlarm: (ivId: string, notes?: string) => Promise<void>;
  confirmNewBag: (ivId: string, bagSizeMl: number, notes?: string) => Promise<void>;

  // Derived helpers (selectors)
  getSortedFiltered: () => TelemetryState[];
  getSummaryBar: () => { critical: number; attention: number; normal: number; stale: number };
  hasUnacknowledgedCritical: () => boolean;
}

let wsInstance: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// Stale threshold: if last update > 60s ago, mark as stale
const STALE_THRESHOLD_MS = 60_000;
// Weight spike threshold to detect new bag: if weight increases by >100g
const NEW_BAG_WEIGHT_SPIKE = 100;

const PRIORITY_RANK: Record<AlarmPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  LOW: 2,
  NORMAL: 3,
};

export const useIVStore = create<IVStore>((set, get) => ({
  ivMap: {},
  wsConnected: false,
  wsRetryCount: 0,
  sortMode: 'urgency',
  filterMode: 'all',
  searchQuery: '',
  selectedIvId: null,
  newBagModalVisible: false,
  newBagIvId: null,
  prevWeightMap: {},

  setSortMode: (m) => set({ sortMode: m }),
  setFilterMode: (m) => set({ filterMode: m }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedIvId: (id) => set({ selectedIvId: id }),
  dismissNewBagModal: () => set({ newBagModalVisible: false, newBagIvId: null }),

  connectWebSocket: () => {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsInstance = ws;

    ws.onopen = () => {
      set({ wsConnected: true, wsRetryCount: 0 });
      // Keep-alive ping every 30s
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PING' }));
        }
      }, 30_000);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        const { ivMap, prevWeightMap } = get();

        if (msg.type === 'INITIAL_STATE') {
          const newMap: Record<string, TelemetryState> = {};
          msg.data.forEach((s) => { newMap[s.sensor_id] = s; });
          set({ ivMap: newMap });

        } else if (msg.type === 'TELEMETRY_UPDATE') {
          const s = msg.data;
          const prevWeight = prevWeightMap[s.sensor_id] ?? s.raw_weight_grams;
          const weightSpike = s.raw_weight_grams - prevWeight;

          // Detect new bag: significant weight increase
          let newBagModalVisible = get().newBagModalVisible;
          let newBagIvId = get().newBagIvId;
          if (weightSpike > NEW_BAG_WEIGHT_SPIKE && !newBagModalVisible) {
            newBagModalVisible = true;
            newBagIvId = s.iv_id;
          }

          set({
            ivMap: { ...ivMap, [s.sensor_id]: s },
            prevWeightMap: { ...prevWeightMap, [s.sensor_id]: s.raw_weight_grams },
            newBagModalVisible,
            newBagIvId,
          });

        } else if (msg.type === 'ALARM_ACKNOWLEDGED') {
          const target = Object.values(ivMap).find(
            (s) => s.iv_id === msg.data.iv_id
          );
          if (target) {
            set({
              ivMap: {
                ...ivMap,
                [target.sensor_id]: { ...target, alarm_acknowledged: true },
              },
            });
          }

        } else if (msg.type === 'BAG_REPLACED') {
          // State will refresh on next telemetry tick
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      set({ wsConnected: false });
    };

    ws.onclose = () => {
      set({ wsConnected: false });
      if (pingInterval) clearInterval(pingInterval);
      // Exponential backoff reconnect
      const retries = get().wsRetryCount;
      const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
      set({ wsRetryCount: retries + 1 });
      setTimeout(() => get().connectWebSocket(), delay);
    };
  },

  disconnectWebSocket: () => {
    if (wsInstance) {
      wsInstance.onclose = null; // prevent auto-reconnect
      wsInstance.close();
      wsInstance = null;
    }
    if (pingInterval) clearInterval(pingInterval);
    set({ wsConnected: false });
  },

  acknowledgeAlarm: async (ivId, notes) => {
    await fetch(API.ACKNOWLEDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iv_id: ivId, nurse_notes: notes }),
    });
  },

  confirmNewBag: async (ivId, bagSizeMl, notes) => {
    await fetch(API.NEW_BAG, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iv_id: ivId, new_bag_size_ml: bagSizeMl, nurse_notes: notes }),
    });
    set({ newBagModalVisible: false, newBagIvId: null });
  },

  getSortedFiltered: () => {
    const { ivMap, sortMode, filterMode, searchQuery } = get();
    const now = Date.now();
    let items = Object.values(ivMap);

    // Filter
    if (filterMode === 'low_volume') {
      items = items.filter((s) => s.percentage < 10);
    } else if (filterMode === 'no_flow') {
      items = items.filter((s) => s.flow_status === 'CRITICAL' || s.drip_rate_gtt_min < 1);
    } else if (filterMode === 'offline') {
      items = items.filter((s) => now - new Date(s.last_update).getTime() > STALE_THRESHOLD_MS);
    } else if (filterMode === 'search' && searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (s) =>
          s.patient_name.toLowerCase().includes(q) ||
          s.room_bed.toLowerCase().includes(q) ||
          s.iv_id.toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortMode === 'urgency') {
      items.sort((a, b) => PRIORITY_RANK[a.alarm_priority] - PRIORITY_RANK[b.alarm_priority]);
    } else if (sortMode === 'eta') {
      items.sort((a, b) => {
        const etaA = _parseEtaMinutes(a.eta_string);
        const etaB = _parseEtaMinutes(b.eta_string);
        return etaA - etaB;
      });
    } else if (sortMode === 'room') {
      items.sort((a, b) => a.room_bed.localeCompare(b.room_bed));
    }

    return items;
  },

  getSummaryBar: () => {
    const { ivMap } = get();
    const now = Date.now();
    let critical = 0, attention = 0, normal = 0, stale = 0;

    Object.values(ivMap).forEach((s) => {
      const isStale = now - new Date(s.last_update).getTime() > STALE_THRESHOLD_MS;
      if (isStale) {
        stale++;
      } else if (s.alarm_priority === 'CRITICAL') {
        critical++;
      } else if (s.alarm_priority === 'HIGH' || s.alarm_priority === 'LOW') {
        attention++;
      } else {
        normal++;
      }
    });

    return { critical, attention, normal, stale };
  },

  hasUnacknowledgedCritical: () => {
    return Object.values(get().ivMap).some(
      (s) =>
        (s.alarm_priority === 'CRITICAL' || s.alarm_priority === 'HIGH') &&
        !s.alarm_acknowledged
    );
  },
}));

/** Parse ETA string like "~2h 30m" or "~45m" into total minutes. */
function _parseEtaMinutes(eta: string): number {
  if (!eta || eta === 'ETA Unavailable') return Infinity;
  const hourMatch = eta.match(/(\d+)h/);
  const minMatch = eta.match(/(\d+)m/);
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  return hours * 60 + mins;
}
