import { useMemo, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type ColorPalette = ReturnType<typeof useColors>;
type SortOption = "newest" | "highest" | "lowest";

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "highest", label: "Highest rated" },
  { id: "lowest", label: "Lowest rated" },
];

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function Stars({ rating, colors }: { rating: number; colors: ColorPalette }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <MaterialIcons key={i} name="star" size={14} color={i < rating ? "#F59E0B" : colors.border} />
      ))}
    </View>
  );
}

export default function ProviderReviewsScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const profileQuery = trpc.provider.myProfile.useQuery(undefined, { enabled: isAuthenticated });
  const reviewsQuery = trpc.provider.myReviews.useQuery(undefined, { enabled: isAuthenticated });
  const respondMutation = trpc.provider.respondToReview.useMutation({
    onSuccess: () => utils.provider.myReviews.invalidate(),
  });
  const reportMutation = trpc.provider.reportReview.useMutation();

  const [sort, setSort] = useState<SortOption>("newest");
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const data = [...(reviewsQuery.data ?? [])];
    switch (sort) {
      case "highest":
        data.sort((a, b) => b.review.rating - a.review.rating);
        break;
      case "lowest":
        data.sort((a, b) => a.review.rating - b.review.rating);
        break;
      default:
        data.sort((a, b) => new Date(b.review.createdAt as any).getTime() - new Date(a.review.createdAt as any).getTime());
    }
    return data;
  }, [reviewsQuery.data, sort]);

  const startReply = (reviewId: number, existing: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReplyingId(reviewId);
    setReplyText(existing ?? "");
    setError(null);
  };

  const submitReply = async (reviewId: number) => {
    if (replyText.trim().length < 1) return;
    setError(null);
    try {
      await respondMutation.mutateAsync({ reviewId, response: replyText.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReplyingId(null);
      setReplyText("");
    } catch (e: any) {
      setError(e?.message ?? "Could not send your reply. Please try again.");
    }
  };

  const submitReport = async () => {
    if (!reportingId) return;
    if (reportReason.trim().length < 10) {
      Alert.alert("Tell us more", "Please describe the issue in at least 10 characters so our team can review it.");
      return;
    }
    try {
      await reportMutation.mutateAsync({ reviewId: reportingId, reason: reportReason.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReportingId(null);
      setReportReason("");
      Alert.alert("Reported", "Thanks — our team will review this within 1–2 business days.");
    } catch (e: any) {
      Alert.alert("Could not report", e?.message ?? "Please try again.");
    }
  };

  const profile = profileQuery.data;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      {profile && (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MaterialIcons name="star" size={20} color="#F59E0B" />
              <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>
                {parseFloat(profile.averageRating).toFixed(1)}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {profile.reviewCount} review{profile.reviewCount === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
      )}

      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {SORT_OPTIONS.map((opt) => {
            const active = sort === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSort(opt.id);
                }}
                style={[styles.sortChip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : colors.foreground }}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {reviewsQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={110} borderRadius={16} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState icon="star-border" title="No reviews yet" description="Reviews from completed jobs will show up here." />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.review.id)}
          contentContainerStyle={{ padding: 20, paddingTop: 10, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: r }) => {
            const isReplying = replyingId === r.review.id;
            return (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {r.customer.avatarUrl ? (
                    <Image source={{ uri: r.customer.avatarUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: `${colors.primary}18`, alignItems: "center", justifyContent: "center" }]}>
                      <MaterialIcons name="person" size={16} color={colors.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", color: colors.foreground, fontSize: 13.5 }} numberOfLines={1}>
                      {r.customer.name ?? "Customer"}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{timeAgo(r.review.createdAt as any)}</Text>
                  </View>
                  <Stars rating={r.review.rating} colors={colors} />
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setReportingId(r.review.id);
                    }}
                    hitSlop={8}
                    style={{ marginLeft: 4 }}
                  >
                    <MaterialIcons name="flag" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>

                {!!r.review.comment && (
                  <Text style={{ fontSize: 13.5, color: colors.foreground, lineHeight: 20, marginTop: 8 }}>{r.review.comment}</Text>
                )}

                {r.review.providerResponse && !isReplying && (
                  <View style={[styles.replyBlock, { backgroundColor: `${colors.primary}0A`, borderColor: `${colors.primary}25` }]}>
                    <Text style={{ fontSize: 11.5, fontWeight: "800", color: colors.primary }}>Your reply</Text>
                    <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 2, lineHeight: 18 }}>{r.review.providerResponse}</Text>
                  </View>
                )}

                {isReplying ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write a public reply…"
                      placeholderTextColor={colors.muted}
                      multiline
                      style={[styles.replyInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                    {error && <Text style={{ fontSize: 12, color: colors.error }}>{error}</Text>}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Button title="Cancel" variant="secondary" size="sm" onPress={() => setReplyingId(null)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button title="Send reply" size="sm" loading={respondMutation.isPending} onPress={() => submitReply(r.review.id)} />
                      </View>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => startReply(r.review.id, r.review.providerResponse)} style={{ marginTop: 10, alignSelf: "flex-start" }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>
                      {r.review.providerResponse ? "Edit reply" : "Reply"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Report modal */}
      <Modal visible={reportingId !== null} animationType="slide" transparent onRequestClose={() => setReportingId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Report review</Text>
              <TouchableOpacity onPress={() => setReportingId(null)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 4 }}>
              Tell us what's wrong with this review. Our team reviews reports within 1–2 business days.
            </Text>
            <TextInput
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="e.g. This review contains false claims / abusive language…"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.replyInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, marginTop: 14, minHeight: 90 }]}
            />
            <View style={{ marginTop: 16 }}>
              <Button title={reportMutation.isPending ? "Sending…" : "Submit report"} loading={reportMutation.isPending} onPress={submitReport} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignSelf: "flex-start" },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  replyBlock: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10 },
  replyInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, minHeight: 70, textAlignVertical: "top" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
});
