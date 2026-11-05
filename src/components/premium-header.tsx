import { View, TouchableOpacity, Text, Image } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { cn } from "@/lib/utils";
import * as Haptics from "expo-haptics";

interface PremiumHeaderProps {
  onThemeToggle?: () => void;
  showLogo?: boolean;
  title?: string;
  subtitle?: string;
}

export function PremiumHeader({
  onThemeToggle,
  showLogo = true,
  title,
  subtitle,
}: PremiumHeaderProps) {
  const colors = useColors();
  const colorScheme = useColorScheme();

  const handleThemeToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onThemeToggle?.();
  };

  return (
    <View
      className="px-6 pt-4 pb-6 flex-row justify-between items-center gap-3"
      style={{ backgroundColor: colors.background }}
    >
      {/* Logo and Title */}
      <View className="flex-1 flex-row items-center gap-2">
        {showLogo && (
          <Image
            source={require("@/assets/images/dranik-logo.jpeg")}
            style={{ width: 48, height: 48 }}
            resizeMode="contain"
          />
        )}
        {(title || subtitle) && (
          <View className="flex-1">
            {title && (
              <Text
                className="text-base font-bold leading-tight"
                style={{ color: colors.foreground }}
              >
                {title}
              </Text>
            )}
            {subtitle && (
              <Text
                className="text-xs"
                style={{ color: colors.muted }}
              >
                {subtitle}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Dark Mode Toggle */}
      <TouchableOpacity
        onPress={handleThemeToggle}
        className="w-10 h-10 rounded-full items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
        }}
      >
        <Text className="text-lg">
          {colorScheme === "dark" ? "☀️" : "🌙"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
