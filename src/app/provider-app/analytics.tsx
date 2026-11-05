import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/**
 * Deliberately doesn't show profile views, service views, or portfolio engagement —
 * no view/click tracking exists anywhere in the app yet, so there's no real number to
 * show. Adding those needs new instrumentation as its own follow-up; this screen only
 * ever shows real, already-existing data.
 */
export default function ProviderAnalyticsScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const analyticsQuery = trpc.provider.analytics.useQuery(undefined, { enabled: isAuthenticated });

  if (analyticsQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  const a = analyticsQuery.data;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      {!a ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <Text style={{ color: colors.muted }}>Couldn't load your analytics right now.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* This month headline card — matches the format sketched in the spec */}
          <View style={[styles.heroCard, { backgroundColor: colors.primary }]}>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>THIS MONTH</Text>
            <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 6 }}>{formatNaira(a.earningsThisMonth)} earned</Text>
            <View style={{ flexDirection: "row", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13 }}>{a.completedBookings} completed</Text>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13 }}>
                {a.reviewCount > 0 ? `${a.averageRating.toFixed(1)} ★ rating` : "No ratings yet"}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[
              { label: "Total bookings", value: String(a.totalBookings), icon: "event-note" as const, tint: colors.primary },
              { label: "Completed bookings", value: String(a.completedBookings), icon: "task-alt" as const, tint: colors.success },
              { label: "Cancellation rate", value: `${a.cancellationRate}%`, icon: "cancel" as const, tint: colors.error },
              { label: "Repeat customers", value: String(a.repeatCustomers), icon: "repeat" as const, tint: colors.primary },
              { label: "Total earnings", value: formatNaira(a.totalEarnings), icon: "account-balance-wallet" as const, tint: colors.success },
              { label: "Earnings this year", value: formatNaira(a.earningsThisYear), icon: "calendar-today" as const, tint: colors.primary },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${s.tint}15`, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={s.icon} size={18} color={s.tint} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginTop: 8 }} numberOfLines={1}>
                  {s.value}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {a.mostBookedService && (
            <View style={[styles.rowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.primary}15`, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="workspace-premium" size={19} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Most booked service</Text>
                <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.foreground }}>{a.mostBookedService}</Text>
              </View>
            </View>
          )}

          <View style={{ backgroundColor: `${colors.muted}10`, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
              Profile views, service views, and portfolio engagement aren't tracked yet, so they're not shown here —
              this screen only shows numbers backed by real data.
            </Text>
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  heroCard: { borderRadius: 20, padding: 20 },
  statCard: { width: "47.5%", borderWidth: 1, borderRadius: 16, padding: 14 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
});
