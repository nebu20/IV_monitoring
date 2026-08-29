import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useIVStore } from '../store/ivStore';
import { useAuthStore } from '../store/authStore';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function useProtectedRoute(user: any) {
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  // Delay redirect to ensure navigator is fully mounted
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const inLogin = segments[0] === 'login';

    if (!user && !inLogin) {
      router.replace('/login');
    } else if (user && inLogin) {
      router.replace('/');
    }
  }, [user, ready, segments]);
}

function AppNavigator() {
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, logout, loadFromStorage } = useAuthStore();
  const connectWebSocket = useIVStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useIVStore((s) => s.disconnectWebSocket);

  useProtectedRoute(user);

  // Load saved auth on mount
  useEffect(() => {
    loadFromStorage();
  }, []);

  // Connect/disconnect WebSocket based on auth
  useEffect(() => {
    if (user) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
  }, [user]);

  const HeaderRight = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 }}>
      <TouchableOpacity
        onPress={toggleTheme}
        style={{
          padding: 6, borderRadius: 20,
          backgroundColor: isDark ? '#334155' : '#e2e8f0',
        }}
      >
        <Ionicons
          name={isDark ? 'sunny-outline' : 'moon-outline'}
          size={17}
          color={isDark ? '#f59e0b' : '#334155'}
        />
      </TouchableOpacity>

      {user && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          backgroundColor: theme.accentMuted,
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
        }}>
          <Ionicons
            name={user.role === 'Superadmin' ? 'star' : user.role === 'Admin' ? 'shield-checkmark-outline' : 'person-outline'}
            size={13} color={theme.accent}
          />
          <TouchableOpacity onPress={() => router.push('/profile')}>
            <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700' }}>
              {user.full_name ?? user.username}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {user && (
        <TouchableOpacity
          onPress={async () => {
            await logout();
            router.replace('/login');
          }}
          style={{ padding: 6 }}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.text.secondary} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={theme.bg.secondary} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg.secondary },
          headerTintColor: theme.text.primary,
          headerTitleStyle: { fontWeight: '700', color: theme.text.primary },
          contentStyle: { backgroundColor: theme.bg.primary },
          headerShadowVisible: false,
          headerRight: () => <HeaderRight />,
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: 'IV Monitor — Central Station' }} />
        <Stack.Screen name="register" options={{ title: 'Register IV Line', presentation: 'modal' }} />
        <Stack.Screen name="start-iv" options={{ headerShown: false }} />
        <Stack.Screen name="sessions" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="admin/index" options={{ title: 'Admin — System Overview' }} />
        <Stack.Screen name="details/[ivId]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
