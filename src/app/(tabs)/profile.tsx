import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getFavorites } from "@/lib/local-store";

type ColorPalette = ReturnType<typeof useColors>;

function StatBox({ value, label, colors }: { value: number | string; label: string; colors: ColorPalette }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>{value}</Text>
      <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center" }}>{label}</Text>
    </View>
  );
}

function formatMemberSince(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}

function MenuRow({
  icon,
  label,
  onPress,
  colors,
  danger,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ColorPalette;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.menuIcon, { backgroundColor: danger ? `${colors.error}12` : `${colors.primary}12` }]}>
        <MaterialIcons name={icon} size={19} color={danger ? colors.error : colors.primary} />
      </View>
      <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "600", color: danger ? colors.error : colors.foreground }}>
        {label}
      </Text>
      <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const { user, isAuthenticated, logout, refresh } = useAuth();
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (user && !editing) {
      setName(user.name ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user, editing]);

  const providerProfileQuery = trpc.provider.myProfile.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfileMutation = trpc.auth.updateProfile.useMutation();
  const uploadFileMutation = trpc.uploads.file.useMutation();
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation();

  const bookingsQuery = trpc.bookings.mine.useQuery(undefined, { enabled: isAuthenticated });
  const reviewsQuery = trpc.reviews.mine.useQuery(undefined, { enabled: isAuthenticated });
  const allServicesQuery = trpc.services.list.useQuery({ limit: 100 }, { enabled: isAuthenticated });

  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  useFocusEffect(
    useCallback(() => {
      getFavorites().then(setFavoriteIds);
    }, []),
  );

  const completedBookingsCount = (bookingsQuery.data ?? []).filter((r) => r.booking.status === "completed").length;
  const reviewsWrittenCount = (reviewsQuery.data ?? []).length;
  const favoriteProviderCount = new Set(
    (allServicesQuery.data ?? [])
      .filter((row) => favoriteIds.includes(row.service.id))
      .map((row) => row.provider.id),
  ).size;

  const saveProfile = async () => {
    if (name.trim().length < 1) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    setSaving(true);
    try {
      await updateProfileMutation.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      const uploaded = await uploadFileMutation.mutateAsync({
        fileName: `avatar-${Date.now()}.jpg`,
        contentType: asset.mimeType ?? "image/jpeg",
        base64: asset.base64 ?? "",
      });
      await updateProfileMutation.mutateAsync({ avatarUrl: uploaded.url });
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message ?? "Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/welcome" as any);
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your D'RANIK account data. This can't be undone. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccountMutation.mutateAsync();
              await logout();
              router.replace("/welcome" as any);
            } catch (e: any) {
              Alert.alert("Could not delete account", e?.message ?? "Please try again.");
            }
          },
        },
      ],
    );
  };

  if (!isAuthenticated || !user) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  const hasProviderProfile = !!providerProfileQuery.data;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Profile</Text>

        {/* Header card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <TouchableOpacity onPress={changeAvatar} disabled={uploadingAvatar}>
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatar} transition={200} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: `${colors.primary}18` }]}>
                  <MaterialIcons name="person" size={30} color={colors.primary} />
                </View>
              )}
              <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons name="camera-alt" size={12} color="#fff" />
                )}
              </View>
            </TouchableOpacity>

            {editing ? (
              <View style={{ flex: 1, gap: 8 }}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone number"
                  keyboardType="phone-pad"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                    {user.name || "Add your name"}
                  </Text>
                  {(user.emailVerified || user.phoneVerified) && (
                    <MaterialIcons name="verified" size={16} color={colors.primary} />
                  )}
                </View>
                <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
                  {user.email}
                </Text>
                {user.phone && <Text style={{ fontSize: 12.5, color: colors.muted }}>{user.phone}</Text>}
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                  Member since {formatMemberSince(user.createdAt)}
                </Text>
              </View>
            )}
          </View>

          <View style={{ marginTop: 14 }}>
            {editing ? (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Save" loading={saving} onPress={saveProfile} />
                </View>
              </View>
            ) : (
              <Button title="Edit profile" variant="tinted" icon={<MaterialIcons name="edit" size={16} color={colors.primary} />} onPress={() => setEditing(true)} />
            )}
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.card, styles.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <StatBox value={completedBookingsCount} label="Completed bookings" colors={colors} />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox value={reviewsWrittenCount} label="Reviews written" colors={colors} />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox value={favoriteProviderCount} label="Favorite providers" colors={colors} />
        </View>

        {/* Provider entry point */}
        {hasProviderProfile ? (
          <MenuRow
            icon="dashboard"
            label="Provider Dashboard"
            colors={colors}
            onPress={() => router.push("/provider-app/dashboard" as any)}
          />
        ) : (
          <MenuRow
            icon="storefront"
            label="Become a Provider"
            colors={colors}
            onPress={() => router.push("/provider-app/onboard" as any)}
          />
        )}

        {/* Menu */}
        <View style={{ gap: 10 }}>
          <MenuRow icon="sync-alt" label="My Negotiations" colors={colors} onPress={() => router.push("/negotiate" as any)} />
          <MenuRow icon="location-on" label="My Addresses" colors={colors} onPress={() => router.push("/addresses" as any)} />
          <MenuRow icon="account-balance-wallet" label="Wallet" colors={colors} onPress={() => router.push("/wallet" as any)} />
          <MenuRow icon="favorite-border" label="Favorites" colors={colors} onPress={() => router.push("/favorites" as any)} />
          <MenuRow icon="star-border" label="My Reviews" colors={colors} onPress={() => router.push("/my-reviews" as any)} />
          <MenuRow icon="settings" label="Settings" colors={colors} onPress={() => router.push("/settings" as any)} />
        </View>

        {/* Account actions */}
        <View style={{ gap: 10 }}>
          <MenuRow icon="logout" label="Log out" colors={colors} onPress={handleLogout} />
          <MenuRow icon="delete-outline" label="Delete account" colors={colors} danger onPress={handleDeleteAccount} />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, padding: 18 },
  statsRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  statDivider: { width: 1, height: 30 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
