import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export default function ProviderServicesScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const servicesQuery = trpc.provider.myServices.useQuery(undefined, { enabled: isAuthenticated });
  const updateMutation = trpc.provider.updateService.useMutation({
    onSuccess: () => utils.provider.myServices.invalidate(),
  });
  const deleteMutation = trpc.provider.deleteService.useMutation({
    onSuccess: () => utils.provider.myServices.invalidate(),
  });

  const confirmDelete = (serviceId: number, title: string) => {
    Alert.alert("Remove service?", `"${title}" will no longer be visible to customers. Existing bookings are kept.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMutation.mutateAsync({ serviceId });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            Alert.alert("Could not remove", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>My services</Text>
        <TouchableOpacity
          onPress={() => router.push("/provider-app/service-form" as any)}
          style={[styles.iconBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
        >
          <MaterialIcons name="add" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {servicesQuery.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (servicesQuery.data ?? []).length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="home-repair-service"
            title="No services yet"
            description="Add your first service so customers can find and book you."
            actionLabel="Add a service"
            onAction={() => router.push("/provider-app/service-form" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={servicesQuery.data}
          keyExtractor={(r) => String(r.service.id)}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          renderItem={({ item: row }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={(row.category?.icon as any) ?? "category"} size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", color: colors.foreground, fontSize: 15 }} numberOfLines={1}>
                    {row.service.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    {row.category?.name ?? "General"} · {formatNaira(Number(row.service.basePrice))}
                    {row.service.priceUnit === "hourly" ? "/hr" : row.service.priceUnit === "per_session" ? "/session" : ""}
                  </Text>
                </View>
                <Switch
                  value={row.service.isActive}
                  onValueChange={(v) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    updateMutation.mutate({ serviceId: row.service.id, isActive: v });
                  }}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => router.push(`/provider-app/service-form?id=${row.service.id}` as any)}
                  style={[styles.smallBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
                >
                  <MaterialIcons name="edit" size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmDelete(row.service.id, row.service.title)}
                  style={[styles.smallBtn, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}30` }]}
                >
                  <MaterialIcons name="delete-outline" size={14} color={colors.error} />
                  <Text style={{ color: colors.error, fontWeight: "700", fontSize: 12 }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
