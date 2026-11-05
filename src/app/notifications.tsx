import { useMemo } from "react";
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

function timeAgo(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  booking_update: "event-note",
  new_booking_request: "event-available",
  payment: "payments",
  promotion: "local-offer",
  service_reminder: "notifications-active",
  message: "chat",
  review: "star-rate",
  system: "info",
};

function groupByDate<T extends { createdAt: Date | string }>(rows: T[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const today: T[] = [];
  const yesterday: T[] = [];
  const earlier: T[] = [];

  for (const row of rows) {
    const d = typeof row.createdAt === "string" ? new Date(row.createdAt) : row.createdAt;
    if (d >= startOfToday) today.push(row);
    else if (d >= startOfYesterday) yesterday.push(row);
    else earlier.push(row);
  }

  return [
    { title: "Today", data: today },
    { title: "Yesterday", data: yesterday },
    { title: "Earlier", data: earlier },
  ].filter((section) => section.data.length > 0);
}

/** Notifications — reached via the bell icon on Home, not a bottom tab. */
export default function NotificationsScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const listQuery = trpc.notifications.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  const rows = listQuery.data ?? [];
  const unreadCount = rows.filter((n) => !n.isRead).length;
  const sections = useMemo(() => groupByDate(rows), [rows]);

  if (!authLoading && !isAuthenticated) {
    return (
      <ScreenContainer className="p-6 justify-center">
        <EmptyState
          icon="notifications-off"
          title="Sign in to see notifications"
          description="Booking updates and offers will appear here."
          actionLabel="Sign in"
          onAction={() => router.push("/welcome" as any)}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={{ fontSize: 12.5, color: colors.muted }}>{unreadCount} unread</Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                markAllRead.mutate();
              }}
              style={[styles.headerBtn, { backgroundColor: `${colors.primary}12` }]}
            >
              <MaterialIcons name="done-all" size={16} color={colors.primary} />
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push("/notification-settings" as any)}
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="settings" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {listQuery.isLoading || authLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={80} borderRadius={16} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="notifications-none"
            title="No notifications yet"
            description="Booking updates, payment receipts, and offers will show up here."
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text
              style={{
                fontSize: 13,
                fontWeight: "800",
                color: colors.muted,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginTop: 14,
                marginBottom: 8,
              }}
            >
              {section.title}
            </Text>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: n }) => {
            const icon = TYPE_ICONS[n.type] ?? "info";
            const bookingId = (n.data as any)?.bookingId;
            const conversationId = (n.data as any)?.conversationId;
            const negotiationId = (n.data as any)?.negotiationId;
            return (
              <TouchableOpacity
                onPress={() => {
                  if (!n.isRead) markRead.mutate({ id: n.id });
                  if (conversationId) {
                    router.push({ pathname: "/chat/[id]" as any, params: { id: String(conversationId) } });
                  } else if (negotiationId) {
                    router.push({ pathname: "/negotiate/[id]" as any, params: { id: String(negotiationId) } });
                  } else if (bookingId) {
                    // new_booking_request only ever goes to the provider on that
                    // booking — the customer-facing screen has no accept/reject
                    // actions, so this one type routes to the provider screen instead.
                    const pathname = n.type === "new_booking_request" ? "/provider-app/booking/[id]" : "/booking/[id]";
                    router.push({ pathname: pathname as any, params: { id: String(bookingId) } });
                  }
                }}
                activeOpacity={0.75}
                style={[
                  styles.notifCard,
                  {
                    backgroundColor: n.isRead ? colors.background : `${colors.primary}08`,
                    borderColor: n.isRead ? colors.border : `${colors.primary}30`,
                  },
                ]}
              >
                <View style={[styles.notifIcon, { backgroundColor: `${colors.primary}12` }]}>
                  <MaterialIcons name={icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <Text
                      style={{ fontSize: 14.5, fontWeight: n.isRead ? "600" : "800", color: colors.foreground, flex: 1 }}
                      numberOfLines={1}
                    >
                      {n.title}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.muted }}>{timeAgo(n.createdAt)}</Text>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }} numberOfLines={2}>
                    {n.body}
                  </Text>
                </View>
                {!n.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  notifCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  notifIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 9, height: 9, borderRadius: 5 },
});
