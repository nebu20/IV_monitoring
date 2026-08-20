/**
 * Root layout — establishes the navigation stack, dark background,
 * and initialises the WebSocket connection on mount.
 */

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useIVStore } from '../store/ivStore';
import { Colors } from '../constants/theme';

export default function RootLayout() {
  const connectWebSocket = useIVStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useIVStore((s) => s.disconnectWebSocket);

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={Colors.bg.primary} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.bg.secondary },
            headerTintColor: Colors.text.primary,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: Colors.bg.primary },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'IV Monitor — Central Station' }} />
          <Stack.Screen name="register" options={{ title: 'Register IV Line', presentation: 'modal' }} />
          <Stack.Screen name="details/[ivId]" options={{ title: 'IV Details' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
