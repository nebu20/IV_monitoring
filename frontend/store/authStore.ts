/**
 * Auth Store — JWT login, logout, current user, role checks.
 * Token stored in memory + AsyncStorage for persistence.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../constants/config';

interface AuthUser {
  username: string;
  role: 'Superadmin' | 'Admin' | 'Nurse';
  full_name?: string;
  staff_id?: string;
  assigned_ward?: string;
  assigned_beds: string[];
  token: string;
}

export type UserRole = 'Superadmin' | 'Admin' | 'Nurse';

interface AuthStore {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  isAdmin: () => boolean;
  isAuthenticated: () => boolean;
}

const TOKEN_KEY = '@iv_auth_token';
const USER_KEY  = '@iv_auth_user';

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const form = new FormData();
      form.append('username', username);
      form.append('password', password);

      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json();
        set({ loading: false, error: err.detail ?? 'Login failed' });
        return false;
      }

      const data = await res.json();
      const user: AuthUser = {
        username: data.username,
        role: data.role,
        full_name: data.full_name,
        staff_id: data.staff_id,
        assigned_ward: data.assigned_ward,
        assigned_beds: data.assigned_beds || [],
        token: data.access_token,
      };

      await AsyncStorage.setItem(TOKEN_KEY, data.access_token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

      // Mark session as active for this browser tab
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('iv_session_active', '1');
      }

      set({ user, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: 'Network error — check server connection' });
      return false;
    }
  },

  logout: async () => {
    await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('iv_session_active');
    }
    set({ user: null });
  },

  loadFromStorage: async () => {
    try {
      // On web, always require fresh login on page load for security
      if (typeof window !== 'undefined' && !sessionStorage.getItem('iv_session_active')) {
        await AsyncStorage.removeItem(TOKEN_KEY);
        await AsyncStorage.removeItem(USER_KEY);
        return;
      }
      const stored = await AsyncStorage.getItem(USER_KEY);
      if (stored) {
        set({ user: JSON.parse(stored) });
      }
    } catch { }
  },

  isAdmin: () => get().user?.role === 'Admin' || get().user?.role === 'Superadmin',
  isAuthenticated: () => get().user !== null,
}));
