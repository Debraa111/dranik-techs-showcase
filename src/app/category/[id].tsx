import { useMemo } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ServiceCard } from "@/components/service-card";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** Dedicated category browsing page: all services within one category. */
export default function CategoryScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoryId = Number(id);

  const categoriesQuery = trpc.categories.list.useQuery();
  const servicesQuery = trpc.services.list.useQuery({ categoryId, limit: 100 });

  const category = useMemo(
    () => (categoriesQuery.data ?? []).find((c) => c.id === categoryId),
    [categoriesQuery.data, categoryId],
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }} numberOfLines={1}>
            {category?.name ?? "Category"}
          </Text>
          {category?.description ? (
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
              {category.description}
            </Text>
          ) : null}
        </View>
        <View style={[styles.catIcon, { backgroundColor: `${colors.primary}12` }]}>
          <MaterialIcons name={(category?.icon as any) || "category"} size={22} color={colors.primary} />
        </View>
      </View>

      {servicesQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width="100%" height={100} borderRadius={16} />
          ))}
        </View>
      ) : (servicesQuery.data ?? []).length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="category"
            title="No services yet"
            description="No providers offer services in this category yet. Check back soon!"
            actionLabel="Browse all services"
            onAction={() => router.replace("/(tabs)/search" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={servicesQuery.data ?? []}
          keyExtractor={(row) => String(row.service.id)}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
              {(servicesQuery.data ?? []).length} service{(servicesQuery.data ?? []).length === 1 ? "" : "s"} available
            </Text>
          }
          renderItem={({ item: row }) => (
            <ServiceCard
              row={row}
              colors={colors}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/service/[id]" as any, params: { id: String(row.service.id) } });
              }}
            />
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  catIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
