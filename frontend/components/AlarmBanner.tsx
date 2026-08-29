import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Typography, Spacing } from '../constants/theme';

interface Props { visible: boolean; criticalCount: number; onPress?: () => void; }

export function AlarmBanner({ visible, criticalCount, onPress }: Props) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) { opacity.setValue(1); return; }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.banner, { opacity, backgroundColor: theme.alarmBg, borderBottomColor: theme.alarmBorder }]}>
      <TouchableOpacity style={styles.inner} onPress={onPress} activeOpacity={0.85}>
        <Ionicons name="warning" size={20} color={theme.alarmText} />
        <Text style={[styles.text, { color: theme.alarmText }]}>
          {criticalCount > 1
            ? `${criticalCount} IV lines require immediate attention — assess now`
            : 'No flow detected — assess IV line immediately'}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={theme.alarmText} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: { borderBottomWidth: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  inner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  text: { flex: 1, fontSize: Typography.sm, fontWeight: '600' },
});
