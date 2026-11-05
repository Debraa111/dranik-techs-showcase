import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type TabKey = "requests" | "active" | "completed" | "declined" | "disputes";

const TABS: { id: TabKey; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "declined", label: "Declined" },
  { id: "disputes", label: "Disputes" },
];

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/** Simple v1 of dispute visibility: cancellation requests on the provider's own
 *  bookings, every status, reusing the same data the admin queue reviews. */
function disputeStatusMeta(status: string, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "pending":
      return { label: "Under review", color: colors.warning, icon: "hourglass-empty" as const };
    case "approved":
      return { label: "Approved", color: colors.error, icon: "check-circle" as const };
    case "rejected":
      return { label: "Rejected", color: colors.success, icon: "block" as const };
    default:
      return { label: status, color: colors.muted, icon: "info" as const };
  }
}

function statusMeta(status: string, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "pending":
      return { label: "New request", color: colors.warning, icon: "hourglass-empty" as const };
    case "confirmed":
      return { label: "Accepted", color: colors.primary, icon: "event-available" as const };
    case "in_progress":
      return { label: "In progress", color: colors.primary, icon: "autorenew" as const };
    case "completed":
      return { label: "Completed", color: colors.success, icon: "check-circle" as const };
    case "cancelled":
      return { label: "Cancelled", color: colors.error, icon: "cancel" as const };
    case "rejected":
      return { label: "Declined", color: colors.error, icon: "block" as const };
    default:
      return { label: status, color: colors.muted, icon: "info" as const };
  }
}

export default function ProviderBookingsScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<TabKey>("requests");

  const bookingsQuery = trpc.provider.bookings.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 20000 });
  const disputesQuery = trpc.provider.cancellationRequests.useQuery(undefined, { enabled: isAuthenticated && tab === "disputes" });

  const filtered = useMemo(() => {
    const rows = bookingsQuery.data ?? [];
    switch (tab) {
      case "requests":
        return rows.filter((r) => r.booking.status === "pending");
      case "active":
        return rows.filter((r) => ["confirmed", "in_progress"].includes(r.booking.status));
      case "completed":
        return rows.filter((r) => r.booking.status === "completed");
      case "declined":
        return rows.filter((r) => ["cancelled", "rejected"].includes(r.booking.status));
      case "disputes":
        return [];
    }
  }, [bookingsQuery.data, tab]);

  const requestCount = (bookingsQuery.data ?? []).filter((r) => r.booking.status === "pending").length;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Bookings</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTab(t.id);
                }}
                style={[
                  styles.tab,
                  { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                ]}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: active ? "#fff" : colors.foreground }}>{t.label}</Text>
                {t.id === "requests" && requestCount > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: active ? "#fff" : colors.error }]}>
                    <Text style={{ fontSize: 10, fontWeight: "800", color: active ? colors.primary : "#fff" }}>{requestCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {tab === "disputes" ? (
        disputesQuery.isLoading || authLoading ? (
          <View style={{ padding: 20, gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={100} borderRadius={16} />
            ))}
          </View>
        ) : (disputesQuery.data ?? []).length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
            <EmptyState icon="gavel" title="No disputes" description="Cancellation requests on your bookings will show up here, whatever the outcome." />
          </View>
        ) : (
          <FlatList
            data={disputesQuery.data}
            keyExtractor={(row) => String(row.request.id)}
            contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: row }) => {
              const meta = disputeStatusMeta(row.request.status, colors);
              return (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({ pathname: "/provider-app/booking/[id]" as any, params: { id: String(row.booking.id) } });
                  }}
                  activeOpacity={0.75}
                  style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: colors.primary }}>{row.booking.reference}</Text>
                    <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
                      <MaterialIcons name={meta.icon} size={13} color={meta.color} />
                      <Text style={{ fontSize: 11.5, fontWeight: "700", color: meta.color }}>{meta.label}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 4 }} numberOfLines={1}>
                    {row.service?.title ?? "Service"}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                    Requested by {row.request.requestedByRole === "customer" ? row.customer?.name ?? "customer" : "you"}
                  </Text>
                  <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 4 }} numberOfLines={2}>
                    {row.request.reason}
                  </Text>
                  {row.request.status === "approved" && (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                      Refund {formatNaira(row.request.refundAmount ?? "0")} · You received {formatNaira(row.request.providerPayoutAmount ?? "0")}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )
      ) : bookingsQuery.isLoading || authLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={110} borderRadius={16} />
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="event-busy"
            title={tab === "requests" ? "No new requests" : `No ${tab} bookings`}
            description={
              tab === "requests" ? "New booking requests from customers will show up here." : "Nothing here yet."
            }
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(row) => String(row.booking.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: row }) => {
            const meta = statusMeta(row.booking.status, colors);
            return (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/provider-app/booking/[id]" as any, params: { id: String(row.booking.id) } });
                }}
                activeOpacity={0.75}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: colors.primary }}>{row.booking.reference}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
                    <MaterialIcons name={meta.icon} size={13} color={meta.color} />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: meta.color }}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 4 }} numberOfLines={1}>
                  {row.service?.title ?? "Service"}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                  {row.customer?.name ?? "Customer"}
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <MaterialIcons name="event" size={14} color={colors.muted} />
                    <Text style={{ fontSize: 12.5, color: colors.muted }}>
                      {row.booking.scheduledDate} · {row.booking.scheduledTime}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{formatNaira(row.booking.total)}</Text>
                </View>
                {row.booking.status === "pending" && row.booking.paymentStatus !== "paid" && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 }}>
                    <MaterialIcons name="info-outline" size={13} color={colors.warning} />
                    <Text style={{ fontSize: 11.5, color: colors.warning }}>Awaiting customer payment — can't accept yet</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  tabBadge: { minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});
