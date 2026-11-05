import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { formatNaira } from "@/components/service-card";
import { formatDistance } from "@/lib/geo";

type ColorPalette = ReturnType<typeof useColors>;

/** Compact provider card: photo, name, profession, rating, starting price. Tap to open the full provider profile. */
export function ProviderCard({
  provider,
  avatarUrl,
  minPrice,
  profession,
  distanceKm,
  colors,
  style,
  onPress,
}: {
  provider: any;
  avatarUrl: string | null;
  minPrice: string | null;
  profession?: string | null;
  distanceKm?: number | null;
  colors: ColorPalette;
  style?: any;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${provider.businessName}, ${parseFloat(provider.averageRating ?? "0").toFixed(1)} star rating`}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} transition={200} />
      ) : (
        <View style={[styles.avatar, styles.imageFallback, { backgroundColor: `${colors.primary}18` }]}>
          <MaterialIcons name="storefront" size={22} color={colors.primary} />
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, flexShrink: 1 }} numberOfLines={1}>
          {provider.businessName}
        </Text>
        <MaterialIcons name="verified" size={13} color={colors.primary} />
      </View>
      {(profession || distanceKm != null) && (
        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
          {[profession, distanceKm != null ? formatDistance(distanceKm) : null].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <MaterialIcons name="star" size={12} color="#F59E0B" />
          <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.foreground }}>
            {parseFloat(provider.averageRating ?? "0").toFixed(1)}
          </Text>
        </View>
        {minPrice ? (
          <Text style={{ fontSize: 11.5, fontWeight: "800", color: colors.primary }}>from {formatNaira(minPrice)}</Text>
        ) : (
          <View />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { width: 150, borderRadius: 18, borderWidth: 1, padding: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
});
