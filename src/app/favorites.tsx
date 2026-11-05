import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { getFavorites, toggleFavorite } from "@/lib/local-store";

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export default function FavoritesScreen() {
  const colors = useColors();
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getFavorites().then((ids) => {
        setFavoriteIds(ids);
        setLoaded(true);
      });
    }, []),
  );

  const servicesQuery = trpc.services.list.useQuery({ limit: 100 });
  const favorites = (servicesQuery.data ?? []).filter((row) => favoriteIds.includes(row.service.id));

  const remove = async (serviceId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavorite(serviceId);
    setFavoriteIds(next);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Favorites</Text>
        <View style={{ width: 40 }} />
      </View>

      {!loaded || servicesQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={90} borderRadius={16} />
          ))}
        </View>
      ) : favorites.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="favorite-border"
            title="No favorites yet"
            description="Tap the heart on any service to save it here."
            actionLabel="Browse services"
            onAction={() => router.push("/(tabs)/search" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(row) => String(row.service.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: row }) => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/service/[id]" as any, params: { id: String(row.service.id) } })}
              activeOpacity={0.75}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={[styles.cardIcon, { backgroundColor: `${colors.primary}12` }]}>
                <MaterialIcons name={(row.category?.icon as any) || "handyman"} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                  {row.service.title}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                  {row.provider?.businessName}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: "800", color: colors.primary }}>
                  {formatNaira(row.service.basePrice)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(row.service.id)} style={{ padding: 8 }}>
                <MaterialIcons name="favorite" size={22} color={colors.error} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  cardIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
