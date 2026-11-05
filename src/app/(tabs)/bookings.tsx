import { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type TabKey = "upcoming" | "active" | "completed" | "cancelled";

const TABS: { id: TabKey; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
];

/** Instant-cancel statuses — mirrors server/db.ts's BOOKING_TRANSITIONS. Once `in_progress`,
 *  cancelling is a request an admin reviews instead (see booking/[id].tsx). */
const CANCELLABLE_STATUSES = ["pending", "confirmed"];

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export default function BookingsScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<TabKey>("upcoming");
  const utils = trpc.useUtils();

  const bookingsQuery = trpc.bookings.mine.useQuery(undefined, { enabled: isAuthenticated });
  const cancelMutation = trpc.bookings.cancel.useMutation({
    onSuccess: () => utils.bookings.mine.invalidate(),
  });

  const handleCancel = (bookingId: number, reference: string) => {
    Alert.alert("Cancel booking", `Cancel booking ${reference}?`, [
      { text: "Keep booking", style: "cancel" },
      {
        text: "Cancel booking",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelMutation.mutateAsync({ id: bookingId });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const statusMeta = (status: string) => {
    switch (status) {
      case "pending":
        return { label: "Pending", color: colors.warning, icon: "hourglass-empty" as const };
      case "confirmed":
        return { label: "Confirmed", color: colors.primary, icon: "event-available" as const };
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
  };

  const filtered = useMemo(() => {
    const rows = bookingsQuery.data ?? [];
    switch (tab) {
      case "upcoming":
        return rows.filter((r) => ["pending", "confirmed"].includes(r.booking.status));
      case "active":
        return rows.filter((r) => r.booking.status === "in_progress");
      case "completed":
        return rows.filter((r) => r.booking.status === "completed");
      case "cancelled":
        return rows.filter((r) => ["cancelled", "rejected"].includes(r.booking.status));
    }
  }, [bookingsQuery.data, tab]);

  if (!authLoading && !isAuthenticated) {
    return (
      <ScreenContainer className="p-6 justify-center">
        <EmptyState
          icon="lock"
          title="Sign in to see your bookings"
          description="Your bookings are linked to your account."
          actionLabel="Sign in"
          onAction={() => router.push("/welcome" as any)}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 14 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.foreground }}>My bookings</Text>
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
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: active ? "#fff" : colors.foreground }}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {bookingsQuery.isLoading || authLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={120} borderRadius={16} />
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="event-busy"
            title={`No ${tab === "completed" ? "completed" : tab} bookings`}
            description={
              tab === "upcoming" ? "Book a service and it will show up here." : "Nothing here yet."
            }
            actionLabel={tab === "upcoming" ? "Browse services" : undefined}
            onAction={tab === "upcoming" ? () => router.push("/(tabs)/search" as any) : undefined}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(row) => String(row.booking.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: row }) => {
            const meta = statusMeta(row.booking.status);
            return (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/booking/[id]" as any, params: { id: String(row.booking.id) } });
                }}
                activeOpacity={0.75}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: colors.primary }}>
                    {row.booking.reference}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
                    <MaterialIcons name={meta.icon} size={13} color={meta.color} />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: meta.color }}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                  {row.service?.title ?? "Service"}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                  {row.provider?.businessName ?? "Provider"}
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <MaterialIcons name="event" size={14} color={colors.muted} />
                    <Text style={{ fontSize: 12.5, color: colors.muted }}>
                      {row.booking.scheduledDate} · {row.booking.scheduledTime}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>
                    {formatNaira(row.booking.total)}
                  </Text>
                </View>

                {row.booking.status === "completed" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      onPress={() =>
                        router.push({ pathname: "/booking/review" as any, params: { bookingId: String(row.booking.id) } })
                      }
                      style={[styles.actionBtn, { backgroundColor: `${colors.primary}12` }]}
                    >
                      <MaterialIcons name="star-rate" size={15} color={colors.primary} />
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>Leave review</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        router.push({ pathname: "/service/[id]" as any, params: { id: String(row.service?.id) } })
                      }
                      style={[styles.actionBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}
                    >
                      <MaterialIcons name="replay" size={15} color={colors.foreground} />
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground }}>Rebook</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {CANCELLABLE_STATUSES.includes(row.booking.status) && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      onPress={() => handleCancel(row.booking.id, row.booking.reference)}
                      style={[styles.actionBtn, { backgroundColor: `${colors.error}12` }]}
                    >
                      <MaterialIcons name="cancel" size={15} color={colors.error} />
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.error }}>Cancel booking</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {row.booking.status === "in_progress" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: "/booking/[id]" as any, params: { id: String(row.booking.id) } })}
                      style={[styles.actionBtn, { backgroundColor: `${colors.error}12` }]}
                    >
                      <MaterialIcons name="report-problem" size={15} color={colors.error} />
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.error }}>Request cancellation</Text>
                    </TouchableOpacity>
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
  tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, borderWidth: 1 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
});
