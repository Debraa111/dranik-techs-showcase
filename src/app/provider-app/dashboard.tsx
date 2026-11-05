import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
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
import { Badge } from "@/components/ui/badge";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export default function ProviderDashboardScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [refreshing, setRefreshing] = useState(false);

  const dashboardQuery = trpc.provider.dashboard.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });
  const bookingsQuery = trpc.provider.bookings.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfileMutation = trpc.provider.updateProfile.useMutation({
    onSuccess: () => utils.provider.dashboard.invalidate(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([dashboardQuery.refetch(), bookingsQuery.refetch()]);
    setRefreshing(false);
  }, [dashboardQuery, bookingsQuery]);

  if (authLoading || dashboardQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <MaterialIcons name="storefront" size={40} color={colors.muted} />
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginTop: 12 }}>
          Provider account required
        </Text>
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6, marginBottom: 16 }}>
          Complete provider onboarding to access your dashboard.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace("/provider-app/onboard" as any)}
          style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Become a Provider</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const { profile, stats } = dashboardQuery.data;
  const pendingBookings = (bookingsQuery.data ?? []).filter((b) => b.booking.status === "pending").slice(0, 3);
  const isAvailable = profile.availabilityStatus === "available";

  const verificationTone =
    profile.verificationStatus === "verified" ? "success" : profile.verificationStatus === "pending" ? "warning" : "neutral";

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as any))}
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>Provider Dashboard</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{profile.businessName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/provider-app/profile" as any)}
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="settings" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Verification + availability */}
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <View style={[styles.availCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: isAvailable ? colors.success : colors.muted,
                }}
              />
              <View>
                <Text style={{ fontWeight: "700", color: colors.foreground }}>
                  {isAvailable ? "You're online" : "You're offline"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {isAvailable ? "Customers can book your services" : "Go online to receive bookings"}
                </Text>
              </View>
            </View>
            <Switch
              value={isAvailable}
              onValueChange={(v) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                updateProfileMutation.mutate({ availabilityStatus: v ? "available" : "offline" });
              }}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          </View>

          {profile.verificationStatus !== "verified" && (
            <View
              style={[
                styles.availCard,
                profile.verificationStatus === "rejected"
                  ? { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}40` }
                  : { backgroundColor: `${colors.warning}10`, borderColor: `${colors.warning}40` },
              ]}
            >
              <MaterialIcons
                name={profile.verificationStatus === "rejected" ? "gpp-bad" : "pending-actions"}
                size={20}
                color={profile.verificationStatus === "rejected" ? colors.error : colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.foreground, fontSize: 13 }}>
                  {profile.verificationStatus === "pending"
                    ? "Verification in review"
                    : profile.verificationStatus === "rejected"
                      ? "Verification rejected"
                      : "Identity verification required"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {profile.verificationStatus === "pending"
                    ? "Our team is reviewing your documents. You can't accept bookings until you're verified."
                    : profile.verificationStatus === "rejected"
                      ? ((profile as any).rejectionReason ?? "Please re-submit valid documents from your profile.")
                      : "Upload a government ID to accept bookings and send quotations."}
                </Text>
              </View>
              {profile.verificationStatus !== "pending" && (
                <TouchableOpacity onPress={() => router.push("/provider-app/profile" as any)}>
                  <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Earnings card */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <TouchableOpacity
            onPress={() => router.push("/provider-app/earnings" as any)}
            activeOpacity={0.9}
            style={[styles.earningsCard, { backgroundColor: colors.primary }]}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: "#ffffffcc", fontSize: 13, fontWeight: "600" }}>Wallet balance</Text>
              <Badge label={profile.verificationStatus === "verified" ? "Verified" : "Unverified"} tone={verificationTone as any} />
            </View>
            <Text style={{ color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 4 }}>
              {formatNaira(stats.walletBalance)}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
              <View>
                <Text style={{ color: "#ffffff99", fontSize: 11 }}>Earned this month</Text>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{formatNaira(stats.earningsThisMonth)}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>View earnings</Text>
                <MaterialIcons name="arrow-forward" size={16} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Stats grid */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, marginTop: 16, gap: 12 }}>
          {[
            { label: "Pending requests", value: String(stats.pendingRequests), icon: "inbox" as const, tint: colors.warning },
            { label: "Jobs today", value: String(stats.jobsToday), icon: "today" as const, tint: colors.primary },
            { label: "Completed jobs", value: String(stats.completedJobs), icon: "task-alt" as const, tint: colors.success },
            { label: "Rating", value: stats.reviewCount > 0 ? `${stats.averageRating.toFixed(1)} (${stats.reviewCount})` : "—", icon: "star" as const, tint: "#F59E0B" },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${s.tint}15`, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={s.icon} size={18} color={s.tint} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginTop: 8 }}>{s.value}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick actions */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground, marginBottom: 10 }}>Manage</Text>
          <View style={{ gap: 10 }}>
            {[
              { label: "Booking requests", desc: `${stats.pendingRequests} awaiting your response`, icon: "event-note" as const, route: "/provider-app/bookings" },
              { label: "Price Negotiations", desc: "Respond to customer offers", icon: "sync-alt" as const, route: "/provider-app/negotiations" },
              { label: "My services", desc: "Add, edit or pause your services", icon: "home-repair-service" as const, route: "/provider-app/services" },
              { label: "Portfolio", desc: "Show off your previous work", icon: "photo-library" as const, route: "/provider-app/portfolio" },
              { label: "Earnings & payouts", desc: "Track income and withdraw", icon: "account-balance-wallet" as const, route: "/provider-app/earnings" },
              { label: "Analytics", desc: "Bookings, earnings, and rating trends", icon: "bar-chart" as const, route: "/provider-app/analytics" },
              { label: "Bank accounts", desc: "Where your withdrawals are sent", icon: "account-balance" as const, route: "/provider-app/bank-accounts" },
              { label: "Availability", desc: "Working hours and blocked dates", icon: "event-available" as const, route: "/provider-app/availability" },
              { label: "Messages", desc: "Chat with your customers", icon: "chat-bubble-outline" as const, route: "/messages" },
              { label: "Reviews", desc: `${stats.reviewCount} customer reviews`, icon: "reviews" as const, route: "/provider-app/reviews" },
              { label: "Provider profile", desc: "Business info and verification", icon: "storefront" as const, route: "/provider-app/profile" },
              { label: "Terms & Conditions", desc: "Your agreement as a provider", icon: "description" as const, route: "/provider-app/terms" },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => router.push(item.route as any)}
                style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name={item.icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: colors.foreground }}>{item.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{item.desc}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Pending requests preview */}
        {pendingBookings.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>New requests</Text>
              <TouchableOpacity onPress={() => router.push("/provider-app/bookings" as any)}>
                <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13 }}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={{ gap: 10 }}>
              {pendingBookings.map((row) => (
                <TouchableOpacity
                  key={row.booking.id}
                  onPress={() => router.push(`/provider-app/booking/${row.booking.id}` as any)}
                  style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${colors.warning}15`, alignItems: "center", justifyContent: "center" }}>
                    <MaterialIcons name="schedule" size={20} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                      {row.service.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      {row.customer.name ?? "Customer"} · {row.booking.scheduledDate} at {row.booking.scheduledTime}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "800", color: colors.foreground }}>{formatNaira(Number(row.booking.total))}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
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
  availCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  earningsCard: {
    borderRadius: 20,
    padding: 20,
    shadowColor: "#2563EB",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statCard: {
    width: "47.5%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
});
