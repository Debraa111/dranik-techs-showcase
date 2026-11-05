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

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Messages tab: all conversations with providers. */
export default function MessagesScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const conversationsQuery = trpc.messages.conversations.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 10000,
  });

  if (!authLoading && !isAuthenticated) {
    return (
      <ScreenContainer className="p-6 justify-center">
        <EmptyState
          icon="chat-bubble-outline"
          title="Sign in to see your messages"
          description="Conversations with providers are linked to your account."
          actionLabel="Sign in"
          onAction={() => router.push("/welcome" as any)}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.foreground }}>Messages</Text>
      </View>

      {conversationsQuery.isLoading || authLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={72} borderRadius={16} />
          ))}
        </View>
      ) : (conversationsQuery.data ?? []).length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="chat-bubble-outline"
            title="No messages yet"
            description="Start a conversation from any provider's profile or an active booking."
            actionLabel="Find services"
            onAction={() => router.replace("/(tabs)/search" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={conversationsQuery.data ?? []}
          keyExtractor={(c) => String(c.conversation.id)}
          contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: c }) => (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/chat/[id]" as any, params: { id: String(c.conversation.id) } });
              }}
              activeOpacity={0.75}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={[styles.avatar, { backgroundColor: `${colors.primary}15` }]}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.primary }}>
                  {(c.provider?.businessName ?? "P").charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                    {c.provider?.businessName ?? "Provider"}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {c.lastMessage ? timeAgo(c.lastMessage.createdAt as any) : ""}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 13, color: colors.muted }} numberOfLines={1}>
                    {c.lastMessage?.content ?? "Say hello 👋"}
                  </Text>
                  {c.unreadCount > 0 && (
                    <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>{c.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
