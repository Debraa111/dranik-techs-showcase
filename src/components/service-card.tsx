import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { PressableScale } from "@/components/pressable-scale";

type ColorPalette = ReturnType<typeof useColors>;

export function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m away` : `${km.toFixed(1)}km away`;
}

/** Service card: real photo, name, provider + verified badge, rating, price. The whole card is tappable. */
export function ServiceCard({
  row,
  colors,
  onPress,
  width,
  distanceKm,
}: {
  row: { service: any; provider: any; category: any };
  colors: ColorPalette;
  onPress: () => void;
  /** Fixed width for horizontal-scroll strips. Omit to fill the container (grid usage). */
  width?: number;
  distanceKm?: number | null;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.card,
        styles.cardShadow,
        { backgroundColor: colors.surface, borderColor: colors.border },
        width ? { width } : { flex: 1 },
      ]}
    >
      {row.service.imageUrl ? (
        <Image source={{ uri: row.service.imageUrl }} style={styles.image} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.image, styles.imageFallback, { backgroundColor: `${colors.primary}12` }]}>
          <MaterialIcons name={(row.category?.icon as any) || "handyman"} size={24} color={colors.primary} />
        </View>
      )}
      <View style={{ padding: 10, gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
          {row.service.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text style={{ fontSize: 11.5, color: colors.muted, flexShrink: 1 }} numberOfLines={1}>
            {row.provider?.businessName}
          </Text>
          {row.provider?.verificationStatus === "verified" && (
            <MaterialIcons name="verified" size={12} color={colors.primary} />
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <MaterialIcons name="star" size={11} color="#F59E0B" />
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.foreground }}>
              {parseFloat(row.provider?.averageRating ?? "0").toFixed(1)}
            </Text>
          </View>
          {distanceKm != null && (
            <Text style={{ fontSize: 10.5, color: colors.muted }} numberOfLines={1}>
              {formatDistance(distanceKm)}
            </Text>
          )}
        </View>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>
          {formatNaira(row.service.basePrice)}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  image: { width: "100%", height: 90 },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
});
