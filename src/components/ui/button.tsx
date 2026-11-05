import * as Haptics from "expo-haptics";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

/**
 * primary   — solid brand blue, white text. Main actions (Book a Service, Continue, Confirm Booking).
 * secondary — outlined, blue border/text, transparent fill. Secondary actions (View Details, Save, Cancel-in-a-dialog).
 * tinted    — light blue-tinted fill, blue text. A softer alternative to secondary (was previously named "secondary").
 * ghost     — no border/fill, muted text. Lowest-emphasis actions (Learn more, Skip, Back to log in).
 * danger    — solid red, white text. Destructive actions (Cancel booking, Decline request).
 * neutral   — solid gray fill, dark text. A distinct-but-not-alarming secondary action.
 */
export type ButtonVariant = "primary" | "secondary" | "tinted" | "ghost" | "danger" | "neutral";

/**
 * Solid, color-coded status buttons — overrides `variant` entirely when set.
 * Maps to this app's real booking-status vocabulary (see BOOKING_STATUSES in schema.ts).
 */
export type ButtonStatus = "confirm" | "cancel" | "reschedule" | "completed" | "ongoing" | "pending";

export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  status?: ButtonStatus;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Shown next to the spinner while `loading`. Defaults to "Please wait...". */
  loadingText?: string;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

type ColorPalette = ReturnType<typeof useColors>;

/** Darkens a plain #RRGGBB hex color toward black by `amount` (0-1). Non-#RRGGBB input is returned unchanged. */
function darken(color: string, amount: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) return color;
  const num = parseInt(match[1], 16);
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** A visible "pressed" shade for any resolved background — solid hex darkens, transparent/alpha fills deepen instead. */
function pressedShade(bg: string, fg: string): string {
  if (bg === "transparent") return `${fg}1A`;
  const alphaHex = /^#([0-9a-fA-F]{6})[0-9a-fA-F]{2}$/.exec(bg);
  if (alphaHex) return `#${alphaHex[1]}33`;
  return darken(bg, 0.15);
}

/** A subtler version of pressedShade, used for the web-only hover state. */
function hoverShade(bg: string, fg: string): string {
  if (bg === "transparent") return `${fg}0D`;
  const alphaHex = /^#([0-9a-fA-F]{6})[0-9a-fA-F]{2}$/.exec(bg);
  if (alphaHex) return `#${alphaHex[1]}20`;
  return darken(bg, 0.06);
}

function resolveStyle(
  colors: ColorPalette,
  variant: ButtonVariant,
  status?: ButtonStatus,
): { bg: string; fg: string; borderColor: string; borderWidth: number } {
  if (status) {
    const bg =
      status === "confirm"
        ? colors.success
        : status === "cancel"
          ? colors.error
          : status === "reschedule"
            ? colors.warning
            : status === "ongoing"
              ? colors.purple
              : status === "pending"
                ? colors.primary
                : colors.border; // "completed"
    return { bg, fg: status === "completed" ? colors.foreground : "#FFFFFF", borderColor: "transparent", borderWidth: 0 };
  }

  switch (variant) {
    case "primary":
      return { bg: colors.primary, fg: "#FFFFFF", borderColor: "transparent", borderWidth: 0 };
    case "danger":
      return { bg: colors.error, fg: "#FFFFFF", borderColor: "transparent", borderWidth: 0 };
    case "tinted":
      return { bg: `${colors.primary}14`, fg: colors.primary, borderColor: "transparent", borderWidth: 0 };
    case "neutral":
      return { bg: colors.border, fg: colors.foreground, borderColor: "transparent", borderWidth: 0 };
    case "ghost":
      return { bg: "transparent", fg: colors.muted, borderColor: "transparent", borderWidth: 0 };
    case "secondary":
    default:
      return { bg: "transparent", fg: colors.primary, borderColor: colors.primary, borderWidth: 1.5 };
  }
}

/**
 * Design-system button — see ButtonVariant/ButtonStatus above for the full role/color vocabulary.
 * Press feedback: a real darker shade of whatever's showing (not just opacity), plus a subtle scale-down.
 * Web builds also get a lighter hover shade; touch platforms have no hover concept so it's a no-op there.
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  status,
  size = "md",
  disabled,
  loading,
  loadingText = "Please wait...",
  fullWidth,
  icon,
}: ButtonProps) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const { bg, fg, borderColor, borderWidth } = resolveStyle(colors, variant, status);
  const pressedBg = pressedShade(bg, fg);
  const hoverBg = hoverShade(bg, fg);

  const height = size === "sm" ? 36 : size === "lg" ? 54 : 46;
  const fontSize = size === "sm" ? 13 : size === "lg" ? 17 : 15;

  const handlePress = () => {
    if (disabled || loading) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      disabled={disabled || loading}
      // NativeWind v4 never invokes a function-form `style` prop on its intercepted
      // Pressable (github.com/nativewind/nativewind issues #847, #1105) — every style
      // this returned silently never applied, leaving buttons as unstyled plain text.
      // Tracking `pressed` via state instead keeps this a plain array, which works.
      style={[
        styles.base,
        {
          backgroundColor: pressed ? pressedBg : Platform.OS === "web" && hovered ? hoverBg : bg,
          borderColor,
          borderWidth,
          height,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          alignSelf: fullWidth ? "stretch" : "auto",
        },
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <>
            <ActivityIndicator size="small" color={fg} />
            <Text style={[styles.label, { color: fg, fontSize }]} numberOfLines={1}>
              {loadingText}
            </Text>
          </>
        ) : (
          <>
            {icon}
            <Text style={[styles.label, { color: fg, fontSize }]} numberOfLines={1}>
              {title}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
  },
  label: {
    fontWeight: "600",
    lineHeight: 20,
    flexShrink: 1,
  },
});
