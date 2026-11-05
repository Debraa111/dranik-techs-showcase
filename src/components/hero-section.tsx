import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

interface HeroSectionProps {
  userName?: string;
  onSearchPress?: () => void;
  searchPlaceholder?: string;
}

export function HeroSection({
  userName = "there",
  onSearchPress,
  searchPlaceholder = "Find trusted professionals",
}: HeroSectionProps) {
  const colors = useColors();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <View className="px-6 pt-2 pb-6 gap-4">
      {/* Greeting */}
      <View>
        <Text
          className="text-3xl font-bold leading-tight"
          style={{ color: colors.foreground }}
        >
          {getGreeting()}, {userName}
        </Text>
        <Text
          className="text-base mt-2"
          style={{ color: colors.muted }}
        >
          Find trusted professionals near you
        </Text>
      </View>

      {/* Premium Search Bar */}
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onSearchPress?.();
        }}
        className="flex-row items-center gap-3 rounded-2xl px-4 py-4"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
        }}
      >
        <Text className="text-xl">🔍</Text>
        <Text
          className="flex-1 text-base"
          style={{ color: colors.muted }}
        >
          {searchPlaceholder}
        </Text>
        <View
          className="w-6 h-6 rounded-full items-center justify-center"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-xs text-white">→</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}
