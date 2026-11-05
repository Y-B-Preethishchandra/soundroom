import { BlurView } from 'expo-blur';
import type { ComponentRef, PropsWithChildren, RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export default function GlassSurface({
  children,
  style,
  contentStyle,
  intensity = 42,
  light = false,
  blurTarget,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  light?: boolean;
  blurTarget?: RefObject<ComponentRef<typeof View> | null>;
}>) {
  return (
    <View style={[styles.surface, light ? styles.surfaceLight : styles.surfaceDark, style]}>
      <BlurView
        blurTarget={blurTarget}
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
        intensity={intensity}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        tint={light ? 'light' : 'dark'}
      />
      <View
        pointerEvents="none"
        style={[styles.tint, light ? styles.tintLight : styles.tintDark]}
      />
      <View
        pointerEvents="none"
        style={[styles.highlight, light ? styles.highlightLight : styles.highlightDark]}
      />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  surfaceDark: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  surfaceLight: {
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderColor: 'rgba(32,35,27,0.11)',
  },
  tint: {
    ...StyleSheet.absoluteFill,
  },
  tintDark: {
    backgroundColor: 'rgba(22,24,20,0.34)',
  },
  tintLight: {
    backgroundColor: 'rgba(250,250,246,0.22)',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: StyleSheet.hairlineWidth,
  },
  highlightDark: {
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  highlightLight: {
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
});
