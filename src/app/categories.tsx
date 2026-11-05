import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { PressableScale } from "@/components/pressable-scale";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

export default function CategoriesScreen() {
  const colors = useColors();
  const categoriesQuery = trpc.categories.list.useQuery();

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Categories</Text>
        <View style={{ width: 40 }} />
      </View>

      {categoriesQuery.isLoading ? (
        <View style={{ padding: 20, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="47%" height={110} borderRadius={18} />
          ))}
        </View>
      ) : (
        <View style={{ padding: 20, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {(categoriesQuery.data ?? []).map((cat) => (
            <PressableScale
              key={cat.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/category/[id]" as any, params: { id: String(cat.id) } });
              }}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={[styles.icon, { backgroundColor: `${colors.primary}14` }]}>
                <MaterialIcons name={(cat.icon as any) || "category"} size={26} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                {cat.name}
              </Text>
              {cat.description && (
                <Text style={{ fontSize: 11.5, color: colors.muted }} numberOfLines={2}>
                  {cat.description}
                </Text>
              )}
            </PressableScale>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { width: "47%", borderRadius: 18, borderWidth: 1, padding: 16, gap: 8 },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
