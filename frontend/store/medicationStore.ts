/**
 * Medication Store
 * ================
 * Manages medication schedules, due doses, and administration actions.
 *
 * Polling design
 * --------------
 * The store holds the current token in state so the setInterval closure
 * always reads the latest value via get().token rather than capturing
 * a stale closure variable.  stopPolling does NOT clear dueDoses to
 * prevent an empty-state flash on screen re-entry — the previous data
 * remains visible until a fresh fetch completes.
 *
 * Error handling
 * --------------
 * Persistent 401 errors (invalidated token) stop the poll loop and set
 * authError = true so the screen can prompt the user to log in again.
 * Transient network errors are tracked in fetchError so the screen can
 * display a non-disruptive banner.
 */

import { create } from 'zustand';
import { MedicationSchedule, DueDose, DoseHistoryEntry } from '../types';
import { BASE_URL, API } from '../constants/config';

interface MedicationStore {
  schedules: MedicationSchedule[];
  dueDoses: DueDose[];
  history: DoseHistoryEntry[];
  loading: boolean;
  fetchError: string | null;
  authError: boolean;           // true when polling receives 401
  pollInterval: ReturnType<typeof setInterval> | null;
  token: string;                // kept in state so the interval reads current value

  setToken: (token: string) => void;
  fetchSchedules: (token: string) => Promise<void>;
  fetchDueDoses: (token: string) => Promise<void>;
  fetchHistory: (token: string, cardId: string) => Promise<void>;
  startPolling: (token: string) => void;
  stopPolling: () => void;

  administerDose: (
    token: string, doseId: number, status: string,
    reason?: string, notes?: string
  ) => Promise<boolean>;
  acknowledgeDose: (token: string, doseId: number, notes?: string) => Promise<boolean>;
  ensureDose: (
    token: string, scheduleId: number, scheduledDatetimeUtc: string
  ) => Promise<number | null>;
}

export const useMedicationStore = create<MedicationStore>((set, get) => ({
  schedules: [],
  dueDoses: [],
  history: [],
  loading: false,
  fetchError: null,
  authError: false,
  pollInterval: null,
  token: '',

  setToken: (token) => set({ token, authError: false }),

  fetchSchedules: async (token) => {
    try {
      const res = await fetch(API.MED_SCHEDULES, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ schedules: await res.json(), fetchError: null });
      } else if (res.status === 401) {
        set({ authError: true });
      }
    } catch (e: any) {
      set({ fetchError: 'Could not load schedules.' });
    }
  },

  fetchDueDoses: async (token) => {
    try {
      const res = await fetch(API.MED_DUE, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ dueDoses: await res.json(), fetchError: null, authError: false });
      } else if (res.status === 401) {
        // Stop polling — token is no longer valid
        const interval = get().pollInterval;
        if (interval) clearInterval(interval);
        set({ pollInterval: null, authError: true });
      } else {
        set({ fetchError: `Server error (${res.status})` });
      }
    } catch {
      set({ fetchError: 'Network error — could not reach server.' });
    }
  },

  fetchHistory: async (token, cardId) => {
    set({ loading: true, fetchError: null });
    try {
      const res = await fetch(API.MED_HISTORY(cardId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ history: await res.json(), loading: false });
      } else {
        set({ loading: false, fetchError: 'Could not load history.' });
      }
    } catch {
      set({ loading: false, fetchError: 'Network error.' });
    }
  },

  startPolling: (token) => {
    // Clear any existing interval before starting a new one
    const existing = get().pollInterval;
    if (existing) clearInterval(existing);

    // Store token in state so the interval closure always reads the latest
    set({ token, authError: false });

    // Immediate first fetch
    get().fetchDueDoses(token);

    const interval = setInterval(() => {
      // Always read the current token from state, not the closure variable
      const currentToken = get().token;
      if (!currentToken || get().authError) {
        clearInterval(interval);
        set({ pollInterval: null });
        return;
      }
      get().fetchDueDoses(currentToken);
    }, 60_000);

    set({ pollInterval: interval });
  },

  stopPolling: () => {
    const interval = get().pollInterval;
    if (interval) clearInterval(interval);
    // NOTE: dueDoses is intentionally NOT cleared here to prevent an
    // empty-state flash when the user navigates back to the screen.
    set({ pollInterval: null, token: '' });
  },

  administerDose: async (token, doseId, status, reason, notes) => {
    try {
      const res = await fetch(
        `${BASE_URL}/api/medications/doses/${doseId}/administer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status, reason, notes }),
        }
      );
      if (res.ok) {
        await get().fetchDueDoses(token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  acknowledgeDose: async (token, doseId, notes) => {
    try {
      const res = await fetch(
        `${BASE_URL}/api/medications/doses/${doseId}/acknowledge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ notes }),
        }
      );
      if (res.ok) {
        await get().fetchDueDoses(token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  ensureDose: async (token, scheduleId, scheduledDatetimeUtc) => {
    try {
      const url = `${API.MED_ENSURE}?schedule_id=${scheduleId}` +
        `&scheduled_datetime=${encodeURIComponent(scheduledDatetimeUtc)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        return (await res.json()).id as number;
      }
      return null;
    } catch {
      return null;
    }
  },
}));
