import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_OPTIONS = Array.from({ length: 18 }, (_, i) => {
  const hour = i + 6; // 06:00 .. 23:00
  return `${String(hour).padStart(2, "0")}:00`;
});

type DayRow = { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string };

function defaultDays(): DayRow[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: dayOfWeek >= 1 && dayOfWeek <= 5, // Mon-Fri open by default
    openTime: "09:00",
    closeTime: "17:00",
  }));
}

function isValidDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

export default function ProviderAvailabilityScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const hoursQuery = trpc.provider.workingHours.useQuery(undefined, { enabled: isAuthenticated });
  const blockedQuery = trpc.provider.blockedDates.useQuery(undefined, { enabled: isAuthenticated });
  const setHoursMutation = trpc.provider.setWorkingHours.useMutation({
    onSuccess: () => utils.provider.workingHours.invalidate(),
  });
  const addBlockedMutation = trpc.provider.addBlockedDate.useMutation({
    onSuccess: () => utils.provider.blockedDates.invalidate(),
  });
  const removeBlockedMutation = trpc.provider.removeBlockedDate.useMutation({
    onSuccess: () => utils.provider.blockedDates.invalidate(),
  });

  const [days, setDays] = useState<DayRow[]>(defaultDays());
  const [loaded, setLoaded] = useState(false);
  const [timePicker, setTimePicker] = useState<{ dayOfWeek: number; field: "openTime" | "closeTime" } | null>(null);
  const [savingHours, setSavingHours] = useState(false);

  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [blockError, setBlockError] = useState<string | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);

  useEffect(() => {
    if (hoursQuery.data && !loaded) {
      if (hoursQuery.data.length === 7) {
        setDays(
          hoursQuery.data
            .slice()
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
            .map((d) => ({
              dayOfWeek: d.dayOfWeek,
              isOpen: d.isOpen,
              openTime: d.openTime ?? "09:00",
              closeTime: d.closeTime ?? "17:00",
            })),
        );
      }
      setLoaded(true);
    }
  }, [hoursQuery.data, loaded]);

  const saveHours = async () => {
    setSavingHours(true);
    try {
      await setHoursMutation.mutateAsync({ days });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSavingHours(false);
    }
  };

  const pickTime = (time: string) => {
    if (!timePicker) return;
    setDays((prev) => prev.map((d) => (d.dayOfWeek === timePicker.dayOfWeek ? { ...d, [timePicker.field]: time } : d)));
    setTimePicker(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const resetBlockForm = () => {
    setStartDate("");
    setEndDate("");
    setReason("");
    setBlockError(null);
  };

  const prefillVacation = () => {
    setReason("Vacation");
    setBlockModalOpen(true);
  };

  const submitBlock = async () => {
    if (!isValidDate(startDate)) return setBlockError("Enter a valid start date (YYYY-MM-DD).");
    if (!isValidDate(endDate)) return setBlockError("Enter a valid end date (YYYY-MM-DD).");
    if (endDate < startDate) return setBlockError("End date can't be before the start date.");
    setBlockError(null);
    setSavingBlock(true);
    try {
      await addBlockedMutation.mutateAsync({ startDate, endDate, reason: reason.trim() || undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBlockModalOpen(false);
      resetBlockForm();
    } catch (e: any) {
      setBlockError(e?.message ?? "Could not save. Please try again.");
    } finally {
      setSavingBlock(false);
    }
  };

  const confirmRemoveBlock = (id: number, label: string) => {
    Alert.alert("Remove this block?", `"${label}" will become bookable again.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeBlockedMutation.mutate({ blockedDateId: id }) },
    ]);
  };

  if (!isAuthenticated || (hoursQuery.isLoading && !loaded)) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  const blocked = blockedQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Availability</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}>
        {/* Working hours */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground }}>Working hours</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: -4 }}>
            For your own reference — customers can still request any time for now.
          </Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            {days.map((d) => (
              <View key={d.dayOfWeek} style={[styles.dayRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.foreground, width: 42 }}>{DAY_SHORT[d.dayOfWeek]}</Text>
                <Switch
                  value={d.isOpen}
                  onValueChange={(v) => setDays((prev) => prev.map((r) => (r.dayOfWeek === d.dayOfWeek ? { ...r, isOpen: v } : r)))}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
                {d.isOpen ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
                    <TouchableOpacity
                      onPress={() => setTimePicker({ dayOfWeek: d.dayOfWeek, field: "openTime" })}
                      style={[styles.timePill, { backgroundColor: colors.background, borderColor: colors.border }]}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground }}>{d.openTime}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>–</Text>
                    <TouchableOpacity
                      onPress={() => setTimePicker({ dayOfWeek: d.dayOfWeek, field: "closeTime" })}
                      style={[styles.timePill, { backgroundColor: colors.background, borderColor: colors.border }]}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground }}>{d.closeTime}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 12.5, color: colors.muted }}>Closed</Text>
                )}
              </View>
            ))}
          </View>
          <Button title={savingHours ? "Saving…" : "Save working hours"} loading={savingHours} onPress={saveHours} />
        </View>

        {/* Blocked dates */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground }}>Blocked dates</Text>
            <TouchableOpacity
              onPress={() => {
                resetBlockForm();
                setBlockModalOpen(true);
              }}
              style={[styles.smallBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
            >
              <MaterialIcons name="add" size={14} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>Add</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={prefillVacation} style={{ alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>Going on vacation? Block a date range →</Text>
          </TouchableOpacity>

          {blocked.length === 0 ? (
            <View style={{ paddingVertical: 10 }}>
              <EmptyState icon="event-busy" title="No blocked dates" description="Block a date or a whole range when you're unavailable." />
            </View>
          ) : (
            <FlatList
              data={blocked}
              keyExtractor={(b) => String(b.id)}
              scrollEnabled={false}
              contentContainerStyle={{ gap: 8, marginTop: 4 }}
              renderItem={({ item: b }) => (
                <View style={[styles.blockRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.foreground }}>
                      {b.startDate === b.endDate ? b.startDate : `${b.startDate} → ${b.endDate}`}
                    </Text>
                    {b.reason && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{b.reason}</Text>}
                  </View>
                  {b.reason === "Vacation" && <Badge label="Vacation" tone="info" />}
                  <TouchableOpacity onPress={() => confirmRemoveBlock(b.id, b.reason || b.startDate)} hitSlop={8} style={{ marginLeft: 8 }}>
                    <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      </ScrollView>

      {/* Time picker */}
      <Modal visible={!!timePicker} transparent animationType="slide" onRequestClose={() => setTimePicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background, maxHeight: "60%" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>
                {timePicker?.field === "openTime" ? "Opening time" : "Closing time"}
              </Text>
              <TouchableOpacity onPress={() => setTimePicker(null)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TIME_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => pickTime(t)}
                    style={[styles.timeOption, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add blocked date */}
      <Modal visible={blockModalOpen} transparent animationType="slide" onRequestClose={() => setBlockModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Block dates</Text>
              <TouchableOpacity onPress={() => setBlockModalOpen(false)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Start date</Text>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>End date</Text>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
            </View>
            <View style={{ gap: 6, marginTop: 14 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Reason (optional)</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Vacation, Personal"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            {blockError && <Text style={{ fontSize: 13, color: colors.error, marginTop: 10 }}>{blockError}</Text>}
            <View style={{ marginTop: 16 }}>
              <Button title={savingBlock ? "Saving…" : "Block these dates"} loading={savingBlock} onPress={submitBlock} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  timePill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  blockRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  timeOption: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
});
