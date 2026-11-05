import { View, Text, TouchableOpacity, Image, ImageSourcePropType } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { Icon } from "@/components/icon-system";
import * as Haptics from "expo-haptics";

interface ServiceCardProductionProps {
  id: string;
  name: string;
  provider: string;
  providerImage?: ImageSourcePropType;
  rating: number;
  reviewCount: number;
  price: string;
  category: string;
  isVerified?: boolean;
  distance?: string;
  estimatedArrival?: string;
  availability?: "available" | "busy" | "offline";
  completedJobs?: number;
  responseTime?: string;
  onPress?: () => void;
  onBook?: () => void;
}

export function ServiceCardProduction({
  id,
  name,
  provider,
  providerImage,
  rating,
  reviewCount,
  price,
  category,
  isVerified = true,
  distance = "2.5 km away",
  estimatedArrival = "15-20 min",
  availability = "available",
  completedJobs = 342,
  responseTime = "< 2 min",
  onPress,
  onBook,
}: ServiceCardProductionProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const getAvailabilityColor = () => {
    switch (availability) {
      case "available":
        return colors.success;
      case "busy":
        return colors.warning;
      case "offline":
        return colors.muted;
      default:
        return colors.success;
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="rounded-3xl overflow-hidden mb-4"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Provider Image Section */}
      <View className="w-full h-48 bg-gradient-to-br from-blue-50 to-blue-100 items-center justify-center overflow-hidden relative">
        {providerImage ? (
          <Image
            source={providerImage}
            className="w-full h-full"
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <View className="w-full h-full items-center justify-center" style={{ backgroundColor: colors.primary + "10" }}>
            <View
              className="w-20 h-20 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.primary + "20" }}
            >
              <Icon name="profile" size={40} color={colors.primary} />
            </View>
          </View>
        )}

        {/* Availability Badge */}
        <View
          className="absolute top-3 right-3 flex-row items-center gap-1 px-3 py-1 rounded-full"
          style={{ backgroundColor: "rgba(255, 255, 255, 0.95)" }}
        >
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: getAvailabilityColor() }}
          />
          <Text
            className="text-xs font-semibold capitalize"
            style={{ color: colors.foreground }}
          >
            {availability}
          </Text>
        </View>
      </View>

      {/* Content Section */}
      <View className="p-4 gap-3">
        {/* Header with Verified Badge */}
        <View className="flex-row justify-between items-start gap-2">
          <View className="flex-1">
            <View className="flex-row items-center gap-1">
              <Text
                className="text-base font-bold leading-tight flex-1"
                style={{ color: colors.foreground }}
              >
                {name}
              </Text>
              {isVerified && (
                <View
                  className="w-5 h-5 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.success }}
                >
                  <Icon name="verified" size={12} color="white" />
                </View>
              )}
            </View>
            <Text
              className="text-sm mt-1"
              style={{ color: colors.muted }}
            >
              {provider}
            </Text>
          </View>
          <View
            className="px-2 py-1 rounded-lg"
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

        {/* Rating and Trust Indicators */}
        <View className="flex-row justify-between items-center gap-2">
          <View className="flex-row items-center gap-3 flex-1">
            {/* Rating */}
            <View className="flex-row items-center gap-1">
              <Icon name="star-filled" size={16} color={colors.primary} />
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.foreground }}
              >
                {rating.toFixed(1)}
              </Text>
              <Text
                className="text-xs"
                style={{ color: colors.muted }}
              >
                ({reviewCount})
              </Text>
            </View>

            {/* Completed Jobs */}
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              •
            </Text>
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              {completedJobs} jobs
            </Text>
          </View>
        </View>

        {/* Distance, Time, Response */}
        <View className="flex-row gap-3 pt-2 border-t" style={{ borderTopColor: colors.border }}>
          <View className="flex-row items-center gap-1 flex-1">
            <Icon name="location" size={14} color={colors.muted} />
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              {distance}
            </Text>
          </View>
          <View className="flex-row items-center gap-1 flex-1">
            <Icon name="clock" size={14} color={colors.muted} />
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              {estimatedArrival}
            </Text>
          </View>
          <View className="flex-row items-center gap-1 flex-1">
            <Icon name="phone" size={14} color={colors.muted} />
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              {responseTime}
            </Text>
          </View>
        </View>

        {/* Price and Book Button */}
        <View className="flex-row justify-between items-center pt-2 gap-2">
          <View>
            <Text
              className="text-xs"
              style={{ color: colors.muted }}
            >
              Starting from
            </Text>
            <Text
              className="text-xl font-bold"
              style={{ color: colors.primary }}
            >
              {price}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onBook?.();
            }}
            className="flex-1 py-3 rounded-2xl items-center justify-center"
            style={{ backgroundColor: colors.primary }}
          >
            <Text className="text-white font-bold text-base">Book Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}
