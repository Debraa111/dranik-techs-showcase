import { View, Text, TouchableOpacity, Image } from "react-native";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

interface ServiceCardPremiumProps {
  id: string;
  name: string;
  provider: string;
  rating: number;
  reviewCount: number;
  price: string;
  category: string;
  isVerified?: boolean;
  distance?: string;
  onPress?: () => void;
}

export function ServiceCardPremium({
  id,
  name,
  provider,
  rating,
  reviewCount,
  price,
  category,
  isVerified = true,
  distance = "2.5 km away",
  onPress,
}: ServiceCardPremiumProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="rounded-2xl overflow-hidden mb-4"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      {/* Image Section */}
      <View className="w-full h-40 bg-gradient-to-r from-blue-100 to-blue-50 items-center justify-center overflow-hidden">
        <View className="w-full h-full items-center justify-center" style={{ backgroundColor: colors.primary + "15" }}>
          <Text className="text-5xl">👨‍💼</Text>
        </View>
      </View>

      {/* Content Section */}
      <View className="p-4 gap-3">
        {/* Header with Verified Badge */}
        <View className="flex-row justify-between items-start gap-2">
          <View className="flex-1">
            <Text
              className="text-base font-bold leading-tight"
              style={{ color: colors.foreground }}
            >
              {name}
            </Text>
            <View className="flex-row items-center gap-1 mt-1">
              <Text
                className="text-sm"
                style={{ color: colors.muted }}
              >
                {provider}
              </Text>
              {isVerified && <Text className="text-xs">✓</Text>}
            </View>
          </View>
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: colors.primary + "15" }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: colors.primary }}
            >
              {category}
            </Text>
          </View>
        </View>

        {/* Rating and Distance */}
        <View className="flex-row justify-between items-center">
          <View className="flex-row items-center gap-1">
            <Text className="text-sm font-semibold" style={{ color: colors.foreground }}>
              ⭐ {rating.toFixed(1)}
            </Text>
            <Text className="text-xs" style={{ color: colors.muted }}>
              ({reviewCount})
            </Text>
          </View>
          <Text className="text-xs" style={{ color: colors.muted }}>
            📍 {distance}
          </Text>
        </View>

        {/* Price */}
        <View className="flex-row justify-between items-center pt-2 border-t" style={{ borderTopColor: colors.border }}>
          <Text
            className="text-lg font-bold"
            style={{ color: colors.primary }}
          >
            {price}
          </Text>
          <TouchableOpacity
            className="px-4 py-2 rounded-full"
            style={{ backgroundColor: colors.primary }}
          >
            <Text className="text-white font-semibold text-sm">Book</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}
