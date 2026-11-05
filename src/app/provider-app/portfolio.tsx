import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type NewImage = { url: string; kind: "before" | "after" | "general"; uploading?: boolean };

export default function ProviderPortfolioScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const portfolioQuery = trpc.provider.myPortfolio.useQuery(undefined, { enabled: isAuthenticated });
  const categoriesQuery = trpc.categories.list.useQuery();
  const uploadFileMutation = trpc.uploads.file.useMutation();
  const addMutation = trpc.provider.addPortfolioItem.useMutation({
    onSuccess: () => utils.provider.myPortfolio.invalidate(),
  });
  const removeMutation = trpc.provider.removePortfolioItem.useMutation({
    onSuccess: () => utils.provider.myPortfolio.invalidate(),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [images, setImages] = useState<NewImage[]>([]);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategoryId(null);
    setImages([]);
  };

  const pickImage = async (kind: "before" | "after" | "general") => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      const asset = result.assets[0];
      const localUri = asset.uri;
      setImages((arr) => [...arr, { url: localUri, kind, uploading: true }]);
      const uploaded = await uploadFileMutation.mutateAsync({
        fileName: `portfolio-${Date.now()}.jpg`,
        contentType: asset.mimeType ?? "image/jpeg",
        base64: asset.base64 ?? "",
      });
      setImages((arr) => arr.map((img) => (img.url === localUri ? { url: uploaded.url, kind } : img)));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      setImages((arr) => arr.filter((img) => !img.uploading));
      Alert.alert("Upload failed", e?.message ?? "Please try again.");
    }
  };

  const submit = async () => {
    if (title.trim().length < 3) {
      Alert.alert("Title required", "Give this work a short title (at least 3 characters).");
      return;
    }
    const ready = images.filter((i) => !i.uploading);
    if (ready.length === 0) {
      Alert.alert("Add photos", "Upload at least one photo of the work.");
      return;
    }
    setSaving(true);
    try {
      await addMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        categoryId: categoryId ?? undefined,
        images: ready.map((i) => ({ url: i.url, kind: i.kind })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      resetForm();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = (itemId: number, itemTitle: string) => {
    Alert.alert("Remove work?", `"${itemTitle}" will be removed from your portfolio.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeMutation.mutate({ itemId }) },
    ]);
  };

  const items = portfolioQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>My portfolio</Text>
        <TouchableOpacity
          onPress={() => setModalOpen(true)}
          style={[styles.iconBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {portfolioQuery.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 }}>
          <MaterialIcons name="photo-library" size={44} color={colors.muted} />
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Show off your work</Text>
          <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>
            Customers check portfolios before booking. Add photos of jobs you have completed — before/after shots work best.
          </Text>
          <View style={{ marginTop: 8 }}>
            <Button title="Add previous work" onPress={() => setModalOpen(true)} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}>
          {items.map((item) => {
            const imgs = (item.images ?? []) as { url: string; kind: string }[];
            return (
              <View key={item.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {imgs.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {imgs.map((img, i) => (
                      <View key={`${item.id}-${i}`}>
                        <Image source={{ uri: img.url }} style={styles.photo} />
                        {img.kind !== "general" && (
                          <View style={[styles.kindTag, { backgroundColor: img.kind === "before" ? "#00000099" : colors.primary }]}>
                            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
                              {img.kind === "before" ? "BEFORE" : "AFTER"}
                            </Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", color: colors.foreground, fontSize: 15 }}>{item.title}</Text>
                    {!!item.description && (
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 18 }} numberOfLines={3}>
                        {item.description}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => confirmRemove(item.id, item.title)} hitSlop={8}>
                    <MaterialIcons name="delete-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.background }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.topBar, { paddingTop: 16 }]}>
            <TouchableOpacity
              onPress={() => {
                setModalOpen(false);
                resetForm();
              }}
              style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <MaterialIcons name="close" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Add previous work</Text>
            <View style={{ width: 36 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Title *</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Full kitchen rewiring in Lekki"
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
                placeholder="What was the job? What did you do?"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 90, textAlignVertical: "top" }]}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Category</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(categoriesQuery.data ?? []).map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: categoryId === c.id ? colors.primary : colors.border,
                      backgroundColor: categoryId === c.id ? `${colors.primary}15` : colors.surface,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: categoryId === c.id ? "700" : "500", color: categoryId === c.id ? colors.primary : colors.foreground }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Photos * (up to 10)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {images.map((img, i) => (
                  <View key={`${img.url}-${i}`}>
                    <Image source={{ uri: img.url }} style={styles.thumb} />
                    {img.uploading ? (
                      <View style={styles.thumbOverlay}>
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => setImages((arr) => arr.filter((_, idx) => idx !== i))}
                        style={styles.removeThumb}
                        hitSlop={8}
                      >
                        <MaterialIcons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {img.kind !== "general" && !img.uploading && (
                      <View style={[styles.kindTagSmall, { backgroundColor: img.kind === "before" ? "#00000099" : colors.primary }]}>
                        <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>
                          {img.kind === "before" ? "BEFORE" : "AFTER"}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              {images.length < 10 && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(
                    [
                      { kind: "before" as const, label: "Before", icon: "history" as const },
                      { kind: "after" as const, label: "After", icon: "auto-fix-high" as const },
                      { kind: "general" as const, label: "Photo", icon: "add-a-photo" as const },
                    ]
                  ).map((b) => (
                    <TouchableOpacity
                      key={b.kind}
                      onPress={() => pickImage(b.kind)}
                      style={[styles.addPhotoBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    >
                      <MaterialIcons name={b.icon} size={16} color={colors.primary} />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{b.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <Button title={saving ? "Saving…" : "Add to portfolio"} loading={saving} onPress={submit} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  photo: {
    width: 140,
    height: 100,
    borderRadius: 10,
  },
  kindTag: {
    position: "absolute",
    top: 6,
    left: 6,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kindTagSmall: {
    position: "absolute",
    bottom: 4,
    left: 4,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
  },
  removeThumb: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#000000cc",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
});
