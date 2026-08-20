/**
 * AlarmBanner — Full-width red flashing banner shown at the top of the
 * dashboard when there are unacknowledged Critical / High Priority alarms.
 * Uses Animated.loop for the pulse effect without any native driver issues.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing } from '../constants/theme';

interface Props {
  visible: boolean;
  criticalCount: number;
  onPress?: () => void;
}

export function AlarmBanner({ visible, criticalCount, onPress }: Props) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      opacity.setValue(1);
      return;
    }
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
    <Animated.View style={[styles.banner, { opacity }]}>
      <TouchableOpacity style={styles.inner} onPress={onPress} activeOpacity={0.85}>
        <Ionicons name="warning" size={20} color={Colors.alarmText} />
        <Text style={styles.text}>
          {criticalCount > 1
            ? `${criticalCount} IV lines require immediate attention — assess now`
            : 'No flow detected — assess IV line immediately'}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={Colors.alarmText} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: Colors.alarmBg,
    borderBottomWidth: 2,
    borderBottomColor: Colors.alarmBorder,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  text: {
    flex: 1,
    color: Colors.alarmText,
    fontSize: Typography.sm,
    fontWeight: '600',
  },
});
