import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

function formatNaira(amount: string | number | null | undefined) {
  if (amount == null) return null;
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Awaiting response", tone: "neutral" },
  negotiating: { label: "Negotiating", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

/** Customer's list of price negotiations. */
export default function MyNegotiationsScreen() {
  const colors = useColors();
  const negotiationsQuery = trpc.negotiations.mine.useQuery();
  const rows = negotiationsQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>My Negotiations</Text>
        <View style={{ width: 40 }} />
      </View>

      {negotiationsQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={90} borderRadius={16} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="sync-alt"
            title="No negotiations yet"
            description="Tap “Negotiate Price” on any service to make an offer and track it here."
            actionLabel="Find services"
            onAction={() => router.replace("/(tabs)/search" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.negotiation.id)}
          contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: r }) => {
            const meta = STATUS_META[r.negotiation.status] ?? { label: r.negotiation.status, tone: "neutral" as BadgeTone };
            const amount = formatNaira(r.negotiation.agreedPrice ?? r.negotiation.suggestedBudget);
            return (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/negotiate/[id]" as any, params: { id: String(r.negotiation.id) } });
                }}
                activeOpacity={0.75}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={1}>
                      {r.serviceTitle ?? "Service"}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{r.negotiation.reference}</Text>
                  </View>
                  <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={1}>
                    {r.providerBusinessName ?? "Provider"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                    <Badge label={meta.label} tone={meta.tone} />
                    {amount && <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{amount}</Text>}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
});
