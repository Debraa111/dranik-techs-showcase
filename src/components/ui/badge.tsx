import { Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

export type BadgeTone = "success" | "warning" | "error" | "neutral" | "info";

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

export function Badge({ label, tone = "neutral", icon }: BadgeProps) {
  const colors = useColors();

  const toneColor =
    tone === "success"
      ? colors.success
      : tone === "warning"
        ? colors.warning
        : tone === "error"
          ? colors.error
          : tone === "info"
            ? colors.primary
            : colors.muted;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: `${toneColor}1A`,
      }}
    >
      {icon}
      <Text style={{ fontSize: 12, fontWeight: "600", color: toneColor }}>{label}</Text>
    </View>
  );
}
