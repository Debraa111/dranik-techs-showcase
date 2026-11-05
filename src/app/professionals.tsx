import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ProviderCard } from "@/components/provider-card";
import { useColors } from "@/hooks/use-colors";
import { useLocation } from "@/hooks/use-location";
import { trpc } from "@/lib/trpc";
import { distanceKm } from "@/lib/geo";

export default function ProfessionalsScreen() {
  const colors = useColors();
  const location = useLocation();
  const featuredQuery = trpc.providers.featured.useQuery({ limit: 20 });
  const rows = featuredQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Professionals</Text>
        <View style={{ width: 40 }} />
      </View>

      {featuredQuery.isLoading ? (
        <View style={{ padding: 20, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="47%" height={170} borderRadius={18} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState icon="storefront" title="No professionals yet" description="Check back soon." />
        </View>
      ) : (
        <FlatList
          data={rows}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 20 }}
          keyExtractor={(row) => String(row.provider.id)}
          contentContainerStyle={{ gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: row }) => (
            <ProviderCard
              provider={row.provider}
              avatarUrl={row.avatarUrl}
              minPrice={row.minPrice}
              profession={row.profession}
              distanceKm={
                location.coords && row.provider.latitude && row.provider.longitude
                  ? distanceKm(
                      location.coords.latitude,
                      location.coords.longitude,
                      parseFloat(row.provider.latitude),
                      parseFloat(row.provider.longitude),
                    )
                  : null
              }
              onPress={() => router.push({ pathname: "/provider/[id]" as any, params: { id: String(row.provider.id) } })}
              colors={colors}
              style={{ flex: 1 }}
            />
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
