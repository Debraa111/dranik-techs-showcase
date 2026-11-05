import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const MAX_IMAGES = 6;

export default function ReviewScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const colors = useColors();
  const id = Number(bookingId);
  const utils = trpc.useUtils();

  const bookingQuery = trpc.bookings.byId.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const reviewMutation = trpc.bookings.review.useMutation();
  const uploadFileMutation = trpc.uploads.file.useMutation();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async () => {
    if (images.length >= MAX_IMAGES) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      for (const asset of result.assets.slice(0, MAX_IMAGES - images.length)) {
        if (!asset.base64) continue;
        const uploaded = await uploadFileMutation.mutateAsync({
          fileName: `review-${Date.now()}.jpg`,
          contentType: asset.mimeType ?? "image/jpeg",
          base64: asset.base64,
        });
        setImages((prev) => [...prev, uploaded.url]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not upload photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImages((prev) => prev.filter((u) => u !== url));
  };

  const submit = async () => {
    if (rating === 0) {
      setError("Please select a star rating.");
      return;
    }
    setError(null);
    try {
      await reviewMutation.mutateAsync({
        bookingId: id,
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
      utils.services.invalidate();
    } catch (e: any) {
      setError(e?.message ?? "Could not submit review.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (done) {
    return (
      <ScreenContainer className="p-6 justify-center">
        <View style={{ alignItems: "center", gap: 16 }}>
          <View style={[styles.doneCircle, { backgroundColor: `${colors.success}15` }]}>
            <MaterialIcons name="check-circle" size={64} color={colors.success} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Thank you!</Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 21 }}>
            Your review helps other customers choose great providers.
          </Text>
          <Button title="Back to bookings" fullWidth onPress={() => router.replace("/(tabs)/bookings" as any)} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Rate your experience</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }} keyboardShouldPersistTaps="handled">
        {bookingQuery.data && (
          <View style={[styles.serviceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
              {bookingQuery.data.service?.title}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>
              {bookingQuery.data.provider?.businessName} · {bookingQuery.data.booking.scheduledDate}
            </Text>
          </View>
        )}

        {/* Stars */}
        <View style={{ alignItems: "center", gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setRating(star);
                }}
              >
                <MaterialIcons
                  name={star <= rating ? "star" : "star-border"}
                  size={44}
                  color={star <= rating ? "#F59E0B" : colors.border}
                />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontSize: 14, fontWeight: "700", color: rating > 0 ? colors.foreground : colors.muted }}>
            {rating > 0 ? RATING_LABELS[rating] : "Tap a star to rate"}
          </Text>
        </View>

        {/* Comment */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
            Share more details (optional)
          </Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="What did you like? What could be better?"
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={[
              styles.commentInput,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </View>

        {/* Photos */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
            Add photos (optional)
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {images.map((url) => (
              <View key={url} style={styles.photoWrap}>
                <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                <TouchableOpacity
                  onPress={() => removePhoto(url)}
                  style={[styles.removeBtn, { backgroundColor: colors.error }]}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <MaterialIcons name="close" size={13} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            {images.length < MAX_IMAGES && (
              <TouchableOpacity
                onPress={addPhoto}
                disabled={uploading}
                style={[styles.addPhotoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <MaterialIcons name="add-a-photo" size={22} color={colors.muted} />
                )}
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {error && <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{error}</Text>}

        <Button
          title="Submit review"
          loadingText="Submitting..."
          size="lg"
          fullWidth
          loading={reviewMutation.isPending}
          onPress={submit}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  serviceCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  commentInput: { borderRadius: 16, borderWidth: 1.5, padding: 14, fontSize: 14, minHeight: 120 },
  doneCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  photoWrap: { width: 72, height: 72 },
  photo: { width: 72, height: 72, borderRadius: 14 },
  removeBtn: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoBtn: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
});
