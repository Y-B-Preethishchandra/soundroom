import Slider from '@react-native-community/slider';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import GlassSurface from './GlassSurface';
import { THEME_COLORS } from './theme';

export type EqualizerSettings = {
  enabled: boolean;
  bands: number[];
};

export const EQUALIZER_BANDS = [
  { label: '60', name: 'SUB BASS', frequency: 60 },
  { label: '250', name: 'BASS', frequency: 250 },
  { label: '1K', name: 'LOW MID', frequency: 1000 },
  { label: '4K', name: 'HIGH MID', frequency: 4000 },
  { label: '16K', name: 'TREBLE', frequency: 16000 },
] as const;

const PRESETS = [
  { name: 'Flat', bands: [0, 0, 0, 0, 0] },
  { name: 'Bass', bands: [7, 5, 1, 0, 1] },
  { name: 'Vocal', bands: [-2, 0, 4, 3, 1] },
  { name: 'Treble', bands: [-1, 0, 1, 4, 7] },
  { name: 'Rock', bands: [5, 3, -1, 2, 4] },
  { name: 'Jazz', bands: [3, 1, 1, 2, 3] },
  { name: 'Classical', bands: [3, 2, -1, 2, 3] },
  { name: 'Electronic', bands: [5, 3, 0, 2, 5] },
] as const;

export function isEqualizerSettings(value: unknown): value is EqualizerSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Partial<EqualizerSettings>;
  return (
    typeof settings.enabled === 'boolean' &&
    Array.isArray(settings.bands) &&
    settings.bands.length === EQUALIZER_BANDS.length &&
    settings.bands.every(
      (band) => typeof band === 'number' && Number.isFinite(band) && band >= -12 && band <= 12,
    )
  );
}

export default function EqualizerSheet({
  visible,
  settings,
  onChange,
  onClose,
  light = false,
}: {
  visible: boolean;
  settings: EqualizerSettings;
  onChange: (settings: EqualizerSettings) => void;
  onClose: () => void;
  light?: boolean;
}) {
  const COLORS = useMemo(() => {
    const palette = THEME_COLORS[light ? 'light' : 'dark'];
    return {
      raised: palette.surfaceRaised,
      text: palette.primaryText,
      secondary: palette.secondaryText,
      muted: palette.muted,
      accent: palette.accent,
      border: palette.border,
      ink: palette.ink,
      controlSurface: palette.controlSurface,
      controlBorder: palette.controlBorder,
      selectedSurface: palette.selectedSurface,
      selectedBorder: palette.selectedBorder,
      backdrop: palette.backdrop,
    };
  }, [light]);
  const styles = useMemo(() => createStyles(COLORS), [COLORS]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <BlurView
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={24}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint={light ? 'light' : 'dark'}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close equalizer"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <GlassSurface light={light} contentStyle={styles.sheetContent} intensity={72} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>SHAPE YOUR SOUND</Text>
              <Text style={styles.title}>Equalizer</Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: settings.enabled }}
              accessibilityLabel="Equalizer"
              onPress={() => onChange({ ...settings, enabled: !settings.enabled })}
              style={[styles.toggle, settings.enabled && styles.toggleOn]}
            >
              <View style={[styles.toggleKnob, settings.enabled && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.presets}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {PRESETS.map((preset) => {
              const selected = preset.bands.every((value, index) => value === settings.bands[index]);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={preset.name}
                  onPress={() => onChange({ ...settings, bands: [...preset.bands] })}
                  style={[styles.preset, selected && styles.presetSelected]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]}>
                    {preset.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.bandList, !settings.enabled && styles.disabled]}>
            {EQUALIZER_BANDS.map((band, index) => (
              <View key={band.name} style={styles.bandRow}>
                <View style={styles.bandLabel}>
                  <Text style={styles.bandName}>{band.name}</Text>
                  <Text style={styles.bandFrequency}>{band.label} HZ</Text>
                </View>
                <Slider
                  accessibilityLabel={`${band.name} equalizer`}
                  disabled={!settings.enabled}
                  maximumTrackTintColor={COLORS.border}
                  maximumValue={12}
                  minimumTrackTintColor={COLORS.accent}
                  minimumValue={-12}
                  onValueChange={(value) => {
                    const bands = [...settings.bands];
                    bands[index] = Math.round(value);
                    onChange({ ...settings, bands });
                  }}
                  step={1}
                  style={styles.slider}
                  thumbTintColor={COLORS.accent}
                  value={settings.bands[index]}
                />
                <Text style={styles.bandValue}>
                  {settings.bands[index] > 0 ? '+' : ''}
                  {settings.bands[index]}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>GAIN</Text>
            <View style={styles.gainScale}>
              <Text style={styles.scaleLabel}>−12 dB</Text>
              <Text style={styles.scaleLabel}>0</Text>
              <Text style={styles.scaleLabel}>+12 dB</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.doneButton}
          >
            <Text style={styles.doneText}>DONE</Text>
          </Pressable>
        </GlassSurface>
      </View>
    </Modal>
  );
}

function createStyles(COLORS: {
  raised: string;
  text: string;
  secondary: string;
  muted: string;
  accent: string;
  border: string;
  ink: string;
  controlSurface: string;
  controlBorder: string;
  selectedSurface: string;
  selectedBorder: string;
  backdrop: string;
}) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: COLORS.backdrop,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomWidth: 0,
    borderColor: COLORS.controlBorder,
  },
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 30,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: COLORS.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    color: COLORS.text,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 5,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 16,
    backgroundColor: COLORS.raised,
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleOn: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.ink,
  },
  presets: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
    marginBottom: 18,
    paddingRight: 4,
  },
  preset: {
    width: 70,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: COLORS.controlSurface,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
  },
  presetSelected: {
    backgroundColor: COLORS.selectedSurface,
    borderColor: COLORS.selectedBorder,
  },
  presetText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '700',
  },
  presetTextSelected: {
    color: COLORS.accent,
  },
  bandList: {
    gap: 9,
  },
  disabled: {
    opacity: 0.4,
  },
  bandRow: {
    height: 39,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bandLabel: {
    width: 66,
  },
  bandName: {
    color: COLORS.text,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  bandFrequency: {
    color: COLORS.muted,
    fontSize: 8,
    marginTop: 4,
  },
  slider: {
    flex: 1,
    height: 35,
    marginHorizontal: 5,
  },
  bandValue: {
    width: 30,
    textAlign: 'right',
    color: COLORS.accent,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
  },
  footerLabel: {
    width: 66,
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  gainScale: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  scaleLabel: {
    color: COLORS.muted,
    fontSize: 8,
  },
  doneButton: {
    height: 48,
    borderRadius: 14,
    marginTop: 24,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: COLORS.ink,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  });
}
