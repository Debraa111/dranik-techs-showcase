import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";

function formatTime(date: string | Date) {
  return new Date(date).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

/**
 * One-on-one conversation thread with a provider.
 *
 * "Realtime" here is a Supabase Realtime Broadcast channel, not a Postgres
 * changes subscription — broadcast is a plain pub/sub relay that never reads
 * from the database, so it needs no RLS policies on `messages`/`conversations`
 * (those tables have none; all access is authorized in the tRPC layer, and a
 * DB-level changes feed would bypass that entirely). The broadcast payload
 * carries no message content, just "something changed, go refetch" — actual
 * content always comes back through the authorized `messages.list` query.
 * A 20s poll stays as a fallback for missed broadcasts/reconnects.
 */
export default function ChatThreadScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const utils = trpc.useUtils();
  const listRef = useRef<FlatList>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [draft, setDraft] = useState("");

  const conversationsQuery = trpc.messages.conversations.useQuery();
  const conversation = useMemo(
    () => (conversationsQuery.data ?? []).find((c) => c.conversation.id === conversationId),
    [conversationsQuery.data, conversationId],
  );

  const messagesQuery = trpc.messages.list.useQuery(
    { conversationId },
    { enabled: !!conversationId, refetchInterval: 20000 },
  );
  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.conversations.invalidate();
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on("broadcast", { event: "message" }, () => {
        utils.messages.list.invalidate({ conversationId });
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, utils.messages.list]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await sendMutation.mutateAsync({ conversationId, content });
      channelRef.current?.send({ type: "broadcast", event: "message", payload: {} });
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      setDraft(content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const messages = messagesQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }} numberOfLines={1}>
            {conversation?.provider?.businessName ?? "Conversation"}
          </Text>
          {conversation?.provider?.availabilityStatus && (
            <Text style={{ fontSize: 11.5, color: colors.muted }}>
              {conversation.provider.availabilityStatus === "available" ? "Usually replies quickly" : "May reply later"}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {messagesQuery.isLoading ? (
          <View style={{ padding: 20, gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width={i % 2 === 0 ? "50%" : "65%"} height={44} borderRadius={16} />
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: 20, gap: 10, flexGrow: 1, justifyContent: "flex-end" }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: m }) => {
              const mine = m.senderId === user?.id;
              return (
                <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                  <View
                    style={[
                      styles.bubble,
                      mine
                        ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                        : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
                    ]}
                  >
                    {m.attachmentUrl && (
                      <Image source={{ uri: m.attachmentUrl }} style={styles.attachment} contentFit="cover" transition={150} />
                    )}
                    <Text style={{ fontSize: 14.5, color: mine ? "#fff" : colors.foreground, lineHeight: 20 }}>
                      {m.content}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 3, marginHorizontal: 4 }}>
                    {formatTime(m.createdAt)}
                  </Text>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
                <MaterialIcons name="chat-bubble-outline" size={32} color={colors.muted} />
                <Text style={{ fontSize: 13, color: colors.muted }}>Say hello 👋</Text>
              </View>
            }
          />
        )}

        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message..."
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || sendMutation.isPending}
            style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <MaterialIcons name="arrow-upward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  attachment: { width: 180, height: 130, borderRadius: 12, marginBottom: 6 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 24 : 14,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
