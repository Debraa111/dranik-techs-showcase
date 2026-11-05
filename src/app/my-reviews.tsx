import { useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** My Reviews: list, edit (rating + comment), and delete the user's reviews. */
export default function MyReviewsScreen() {
  const colors = useColors();
  const reviewsQuery = trpc.reviews.mine.useQuery();
  const updateMutation = trpc.reviews.update.useMutation();
  const removeMutation = trpc.reviews.remove.useMutation();

  const [editing, setEditing] = useState<{ id: number; rating: number; comment: string } | null>(null);

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({
        reviewId: editing.id,
        rating: editing.rating,
        comment: editing.comment.trim() ? editing.comment.trim() : null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(null);
      reviewsQuery.refetch();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    }
  };

  const confirmDelete = (reviewId: number) => {
    Alert.alert("Delete review?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await removeMutation.mutateAsync({ reviewId });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            reviewsQuery.refetch();
          } catch (e: any) {
            Alert.alert("Could not delete", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>My reviews</Text>
        <View style={{ width: 40 }} />
      </View>

      {reviewsQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={110} borderRadius={16} />
          ))}
        </View>
      ) : (reviewsQuery.data ?? []).length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="star-border"
            title="No reviews yet"
            description="After a booking is completed, you can rate the provider and your review will appear here."
            actionLabel="View bookings"
            onAction={() => router.replace("/(tabs)/bookings" as any)}
          />
        </View>
      ) : (
        <FlatList
          data={reviewsQuery.data ?? []}
          keyExtractor={(r) => String(r.review.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: r }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                  {r.provider?.businessName ?? "Provider"}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.muted }}>
                  {new Date(r.review.createdAt as any).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 2 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <MaterialIcons key={s} name={s <= r.review.rating ? "star" : "star-border"} size={16} color="#F59E0B" />
                ))}
              </View>
              {!!r.review.comment && (
                <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.foreground }}>{r.review.comment}</Text>
              )}
              {!!r.review.images?.length && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {r.review.images!.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} contentFit="cover" transition={150} />
                  ))}
                </ScrollView>
              )}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setEditing({ id: r.review.id, rating: r.review.rating, comment: r.review.comment ?? "" });
                  }}
                  style={[styles.actionBtn, { borderColor: colors.border }]}
                >
                  <MaterialIcons name="edit" size={15} color={colors.primary} />
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmDelete(r.review.id)}
                  style={[styles.actionBtn, { borderColor: colors.border }]}
                >
                  <MaterialIcons name="delete-outline" size={15} color={colors.error} />
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.error }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Edit modal */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Edit review</Text>
              <TouchableOpacity onPress={() => setEditing(null)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setEditing((e) => (e ? { ...e, rating: s } : e));
                  }}
                >
                  <MaterialIcons
                    name={editing && s <= editing.rating ? "star" : "star-border"}
                    size={34}
                    color="#F59E0B"
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={editing?.comment ?? ""}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, comment: t } : e))}
              placeholder="Share your experience (optional)"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button
              title={updateMutation.isPending ? "Saving..." : "Save changes"}
              fullWidth
              loading={updateMutation.isPending}
              onPress={saveEdit}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  photo: { width: 68, height: 68, borderRadius: 10 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, gap: 16, paddingBottom: 40 },
  input: { borderRadius: 14, borderWidth: 1.5, padding: 13, fontSize: 14, minHeight: 90, textAlignVertical: "top" },
});
