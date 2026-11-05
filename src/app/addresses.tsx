import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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

export default function AddressesScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const listQuery = trpc.addresses.list.useQuery(undefined, { enabled: isAuthenticated });
  const createMutation = trpc.addresses.create.useMutation({
    onSuccess: () => utils.addresses.list.invalidate(),
  });
  const removeMutation = trpc.addresses.remove.useMutation({
    onSuccess: () => utils.addresses.list.invalidate(),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!line1.trim() || !city.trim() || !stateName.trim()) {
      setError("Address, city and state are required.");
      return;
    }
    setError(null);
    try {
      await createMutation.mutateAsync({
        label: label.trim() || undefined,
        addressLine1: line1.trim(),
        city: city.trim(),
        state: stateName.trim(),
        isDefault,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      setLabel("");
      setLine1("");
      setCity("");
      setStateName("");
      setIsDefault(false);
    } catch (e: any) {
      setError(e?.message ?? "Could not save address.");
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Saved addresses</Text>
        <TouchableOpacity onPress={() => setModalOpen(true)} style={[styles.iconBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}>
          <MaterialIcons name="add" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {listQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={84} borderRadius={16} />
          ))}
        </View>
      ) : (listQuery.data ?? []).length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="location-off"
            title="No saved addresses"
            description="Add an address to speed up your bookings."
            actionLabel="Add address"
            onAction={() => setModalOpen(true)}
          />
        </View>
      ) : (
        <FlatList
          data={listQuery.data}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          renderItem={({ item: a }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.cardIcon, { backgroundColor: `${colors.primary}12` }]}>
                <MaterialIcons name="place" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.foreground }}>
                    {a.label || "Address"}
                  </Text>
                  {a.isDefault && (
                    <View style={[styles.defaultPill, { backgroundColor: `${colors.success}15` }]}>
                      <Text style={{ fontSize: 10.5, fontWeight: "700", color: colors.success }}>Default</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={2}>
                  {a.addressLine1}, {a.city}, {a.state}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  removeMutation.mutate({ id: a.id });
                }}
                style={{ padding: 8 }}
              >
                <MaterialIcons name="delete-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>New address</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Label (e.g. Home, Office)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
            <TextInput
              value={line1}
              onChangeText={setLine1}
              placeholder="Street address"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                value={city}
                onChangeText={setCity}
                placeholder="City"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              <TextInput
                value={stateName}
                onChangeText={setStateName}
                placeholder="State"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            <TouchableOpacity
              onPress={() => setIsDefault((v) => !v)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <MaterialIcons
                name={isDefault ? "check-box" : "check-box-outline-blank"}
                size={22}
                color={isDefault ? colors.primary : colors.muted}
              />
              <Text style={{ fontSize: 14, color: colors.foreground }}>Set as default address</Text>
            </TouchableOpacity>
            {error && <Text style={{ fontSize: 13, color: colors.error }}>{error}</Text>}
            <Button
              title={createMutation.isPending ? "Saving..." : "Save address"}
              fullWidth
              loading={createMutation.isPending}
              onPress={submit}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  cardIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  defaultPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, gap: 14, paddingBottom: 40 },
  input: { borderRadius: 14, borderWidth: 1.5, padding: 13, fontSize: 14 },
});
