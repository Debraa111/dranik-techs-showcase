import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/tag-input";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const PRICE_UNITS = [
  { key: "fixed", label: "Fixed price" },
  { key: "hourly", label: "Per hour" },
  { key: "per_session", label: "Per session" },
] as const;

const MAX_IMAGES = 6;

export default function ProviderServiceFormScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id ? Number(id) : undefined;
  const isEditing = Number.isFinite(editingId) && (editingId ?? 0) > 0;
  const utils = trpc.useUtils();

  const categoriesQuery = trpc.categories.list.useQuery();
  const myServicesQuery = trpc.provider.myServices.useQuery(undefined, { enabled: isAuthenticated && isEditing });
  const createMutation = trpc.provider.createService.useMutation();
  const updateMutation = trpc.provider.updateService.useMutation();
  const uploadFileMutation = trpc.uploads.file.useMutation();

  const editingRow = useMemo(
    () => (isEditing ? (myServicesQuery.data ?? []).find((r) => r.service.id === editingId) : undefined),
    [isEditing, myServicesQuery.data, editingId],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<(typeof PRICE_UNITS)[number]["key"]>("fixed");
  const [duration, setDuration] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [materials, setMaterials] = useState<string[]>([]);
  const [isEmergency, setIsEmergency] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (editingRow && !prefilled) {
      setTitle(editingRow.service.title);
      setDescription(editingRow.service.description ?? "");
      setPrice(String(Number(editingRow.service.basePrice)));
      setPriceUnit((editingRow.service.priceUnit as any) ?? "fixed");
      setDuration(editingRow.service.durationMinutes ? String(editingRow.service.durationMinutes) : "");
      setCategoryId(editingRow.service.categoryId);
      const existingImages = (editingRow.service as any).images as string[] | null | undefined;
      setImages(
        existingImages && existingImages.length > 0
          ? existingImages
          : editingRow.service.imageUrl
            ? [editingRow.service.imageUrl]
            : [],
      );
      setMaterials((editingRow.service as any).materials ?? []);
      setIsEmergency(Boolean((editingRow.service as any).isEmergency));
      setTags((editingRow.service as any).tags ?? []);
      setPrefilled(true);
    }
  }, [editingRow, prefilled]);

  const addPhotos = async () => {
    if (images.length >= MAX_IMAGES) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (result.canceled || !result.assets?.length) return;
    setUploadingImage(true);
    try {
      for (const asset of result.assets.slice(0, MAX_IMAGES - images.length)) {
        if (!asset.base64) continue;
        const uploaded = await uploadFileMutation.mutateAsync({
          fileName: `service-${Date.now()}.jpg`,
          contentType: asset.mimeType ?? "image/jpeg",
          base64: asset.base64,
        });
        setImages((prev) => [...prev, uploaded.url]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not upload photo. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const removePhoto = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImages((prev) => prev.filter((u) => u !== url));
  };

  const submit = async () => {
    const priceNum = parseFloat(price);
    if (title.trim().length < 3) return setError("Please enter a service title (at least 3 characters).");
    if (!isEditing && !categoryId) return setError("Please choose a category.");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setError("Please enter a valid price.");
    setError(null);
    setSubmitting(true);
    try {
      if (isEditing && editingId) {
        await updateMutation.mutateAsync({
          serviceId: editingId,
          title: title.trim(),
          description: description.trim() || undefined,
          basePrice: priceNum,
          images: images.length > 0 ? images : undefined,
          materials,
          isEmergency,
          tags,
        });
      } else {
        await createMutation.mutateAsync({
          categoryId: categoryId!,
          title: title.trim(),
          description: description.trim() || undefined,
          basePrice: priceNum,
          priceUnit,
          images: images.length > 0 ? images : undefined,
          durationMinutes: duration ? Math.max(15, Math.min(1440, parseInt(duration, 10) || 60)) : undefined,
          materials,
          isEmergency,
          tags,
        });
      }
      await utils.provider.myServices.invalidate();
      await utils.services.invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Could not save the service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isEditing && myServicesQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
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
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
            {isEditing ? "Edit service" : "Add a service"}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Photos</Text>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: images.length >= MAX_IMAGES ? colors.error : colors.muted,
                }}
              >
                {images.length}/{MAX_IMAGES}
              </Text>
            </View>
            <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: -4 }}>
              The first photo is used as the cover image everywhere else in the app.
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
                  onPress={addPhotos}
                  disabled={uploadingImage}
                  style={[styles.addPhotoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  {uploadingImage ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <View style={{ alignItems: "center", gap: 4 }}>
                      <MaterialIcons name="add-a-photo" size={22} color={colors.muted} />
                      <Text style={{ fontSize: 11, color: colors.muted }}>Add</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {!isEditing && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Category *</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(categoriesQuery.data ?? []).map((c) => {
                  const active = categoryId === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setCategoryId(c.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : colors.muted }}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Service title *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. AC installation & repair"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What's included, your process, materials…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 110, textAlignVertical: "top" }]}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Price (₦) *</Text>
            <TextInput
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 15000"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
            <Text style={{ fontSize: 11.5, color: colors.muted }}>
              Customers can always offer a different price via Negotiate Price — this is just your listed starting price.
            </Text>
          </View>

          {!isEditing && (
            <>
              <View style={{ gap: 8 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Pricing type</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {PRICE_UNITS.map((u) => {
                    const active = priceUnit === u.key;
                    return (
                      <TouchableOpacity
                        key={u.key}
                        onPress={() => setPriceUnit(u.key)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active ? colors.primary : colors.surface,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : colors.muted }}>{u.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Typical duration (minutes)</Text>
                <TextInput
                  value={duration}
                  onChangeText={(t) => setDuration(t.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 90"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
            </>
          )}

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Materials used (optional)</Text>
            <TagInput values={materials} onChange={setMaterials} placeholder="e.g. Copper pipe" colors={colors} />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Tags (optional)</Text>
            <TagInput values={tags} onChange={setTags} placeholder="e.g. Same-day" colors={colors} />
          </View>

          <View
            style={[
              styles.emergencyRow,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Emergency service</Text>
              <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                Flag this as available for urgent, same-day callouts.
              </Text>
            </View>
            <Switch
              value={isEmergency}
              onValueChange={setIsEmergency}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {error && (
            <View style={[styles.errorBox, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}40` }]}>
              <MaterialIcons name="error-outline" size={18} color={colors.error} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.error }}>{error}</Text>
            </View>
          )}

          <Button
            title={isEditing ? "Save changes" : "Publish service"}
            loadingText="Saving…"
            loading={submitting}
            onPress={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  photoWrap: { width: 90, height: 90 },
  photo: { width: 90, height: 90, borderRadius: 14 },
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
    width: 90,
    height: 90,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emergencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  errorBox: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "flex-start",
  },
});
