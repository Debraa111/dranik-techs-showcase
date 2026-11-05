import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { Button } from "./button";

interface EmptyStateProps {
  icon: ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const colors = useColors();

  return (
    <View style={{ alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface,
        }}
      >
        <MaterialIcons name={icon} size={28} color={colors.muted} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>
        {title}
      </Text>
      {description && (
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 18 }}>
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} variant="tinted" size="sm" />
      )}
    </View>
  );
}
