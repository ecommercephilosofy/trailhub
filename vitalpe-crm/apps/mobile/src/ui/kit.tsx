/**
 * The shared pieces of the phone UI.
 *
 * Every token comes from `src/core/theme.ts`, which mirrors the web stylesheet,
 * so the two surfaces stay recognisably the same product without sharing a
 * single line of CSS. Nothing here decides anything: these are shapes.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MIN_TOUCH_TARGET, colors, radius, space, tones, typography, type Tone } from '../core/theme';

export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.screenContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl
            refreshing={refreshing === true}
            onRefresh={onRefresh}
            tintColor={colors.burgundy}
          />
        )
      }
    >
      {refreshing === true && onRefresh === undefined && (
        <ActivityIndicator color={colors.burgundy} style={{ marginBottom: space.sm }} />
      )}
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Body({ children, soft }: { children: ReactNode; soft?: boolean }) {
  return <Text style={[s.body, soft === true && { color: colors.inkSoft }]}>{children}</Text>;
}

export function Faint({ children }: { children: ReactNode }) {
  return <Text style={s.faint}>{children}</Text>;
}

/** The `.estat-*` chip. The mark is a shape, so colour never carries meaning alone. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = tones[tone];
  return (
    <View style={[s.chip, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[s.chipText, { color: t.fg }]}>
        {t.mark} {children}
      </Text>
    </View>
  );
}

export function Button({
  children,
  onPress,
  variant = 'default',
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        variant === 'primary' && s.buttonPrimary,
        variant === 'danger' && s.buttonDanger,
        pressed && { opacity: 0.75 },
        disabled === true && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[
          s.buttonText,
          variant === 'primary' && { color: colors.onBurgundy },
          variant === 'danger' && { color: colors.danger },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={s.empty}>{children}</Text>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  screenContent: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  card: {
    backgroundColor: colors.paperRaised,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  label: {
    ...typography.label,
    color: colors.inkFaint,
    textTransform: 'uppercase',
  },
  title: { ...typography.title, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  faint: { ...typography.bodySmall, color: colors.inkFaint },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  chipText: { ...typography.label },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.paperRaised,
  },
  buttonPrimary: { backgroundColor: colors.burgundy, borderColor: colors.burgundy },
  buttonDanger: { borderColor: colors.danger },
  buttonText: { ...typography.button, color: colors.ink, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' },
  empty: { ...typography.bodySmall, color: colors.inkFaint, fontStyle: 'italic' },
});
