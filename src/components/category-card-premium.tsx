import { View, Text, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

interface CategoryCardPremiumProps {
  id: string;
  name: string;
  icon: string;
  count?: number;
  onPress?: () => void;
}

export function CategoryCardPremium({
  id,
  name,
  icon,
  count,
  onPress,
}: CategoryCardPremiumProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="flex-1 rounded-2xl p-4 items-center justify-center gap-2"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        minHeight: 120,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      <Text className="text-4xl">{icon}</Text>
      <Text
        className="text-sm font-semibold text-center leading-tight"
        style={{ color: colors.foreground }}
      >
        {name}
      </Text>
      {count && (
        <Text
          className="text-xs"
          style={{ color: colors.muted }}
        >
          {count} providers
        </Text>
      )}
    </TouchableOpacity>
  );
}
