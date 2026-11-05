import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";

type ColorPalette = ReturnType<typeof useColors>;
const MAX_COMPLETION_PHOTOS = 6;

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatDateTime(date: string, time: string) {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return `${date} · ${time}`;
  return `${d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

/** Order status-kind steps can occur in — used to derive "reached" without a history query here. */
const STATUS_ORDER = ["pending", "confirmed", "in_progress", "completed"];

type StepSource = { kind: "status"; status: string } | { kind: "checkpoint"; type: string };

/**
 * 6 visual stages, matching the customer-facing tracker (`src/app/booking/[id].tsx`).
 * "On My Way" / "In Progress" come from the P4a checkpoint log (on_the_way/arrived),
 * which a provider can post in any order or skip — each step lights up purely on
 * whether its own event happened, not on real chronological order.
 */
const STEPS = [
  { key: "requested", label: "Requested", icon: "hourglass-empty" as const, source: { kind: "status", status: "pending" } as StepSource },
  { key: "accepted", label: "Accepted", icon: "event-available" as const, source: { kind: "status", status: "confirmed" } as StepSource },
  { key: "on_the_way", label: "On My Way", icon: "directions-car" as const, source: { kind: "checkpoint", type: "on_the_way" } as StepSource },
  { key: "started", label: "Started", icon: "play-circle-outline" as const, source: { kind: "status", status: "in_progress" } as StepSource },
  { key: "in_progress", label: "In Progress", icon: "autorenew" as const, source: { kind: "checkpoint", type: "arrived" } as StepSource },
  { key: "completed", label: "Completed", icon: "check-circle" as const, source: { kind: "status", status: "completed" } as StepSource },
];

/** "Work started" isn't here — it's already the in_progress status/Start Job action, not a checkpoint. */
const PROGRESS_TYPES: { key: "on_the_way" | "arrived" | "waiting_for_customer"; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: "on_the_way", label: "On the way", icon: "directions-car" as const },
  { key: "arrived", label: "Arrived", icon: "location-on" as const },
  { key: "waiting_for_customer", label: "Waiting for customer", icon: "hourglass-top" as const },
];

function timeAgoShort(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusTimeline({
  status,
  progressUpdates,
  colors,
}: {
  status: string;
  progressUpdates: { type: string }[];
  colors: ColorPalette;
}) {
  if (status !== "pending" && status !== "confirmed" && status !== "in_progress" && status !== "completed") return null;

  const reachedFlags = STEPS.map((step) => {
    const source = step.source;
    if (source.kind === "status") {
      return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(source.status);
    }
    return progressUpdates.some((p) => p.type === source.type);
  });
  let currentIndex = -1;
  for (let i = reachedFlags.length - 1; i >= 0; i--) {
    if (reachedFlags[i]) {
      currentIndex = i;
      break;
    }
  }

  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {STEPS.map((step, i) => {
        const reached = reachedFlags[i];
        return (
          <View key={step.key} style={{ alignItems: "center", flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
              <View style={[styles.stepLine, { backgroundColor: i === 0 ? "transparent" : reached ? colors.primary : colors.border }]} />
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: reached ? colors.primary : colors.surface, borderColor: reached ? colors.primary : colors.border },
                ]}
              >
                <MaterialIcons name={step.icon} size={13} color={reached ? "#fff" : colors.muted} />
              </View>
              <View style={[styles.stepLine, { backgroundColor: i === STEPS.length - 1 ? "transparent" : i < currentIndex ? colors.primary : colors.border }]} />
            </View>
            <Text style={{ fontSize: 10, fontWeight: i === currentIndex ? "800" : "600", color: reached ? colors.foreground : colors.muted, marginTop: 4, textAlign: "center" }}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ProviderBookingDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<"idle" | "rejecting" | "completing" | "cancelling">("idle");
  const [reason, setReason] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [completionPhotos, setCompletionPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releaseCodeInput, setReleaseCodeInput] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseSuccess, setReleaseSuccess] = useState<{ earning: number } | null>(null);

  const bookingQuery = trpc.bookings.byId.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const updateStatusMutation = trpc.bookings.updateStatus.useMutation();
  const confirmReleaseCodeMutation = trpc.bookings.confirmReleaseCode.useMutation();
  const startConversation = trpc.messages.startWithCustomer.useMutation();
  const uploadFileMutation = trpc.uploads.file.useMutation();
  const progressQuery = trpc.bookings.progressUpdates.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const progressMutation = trpc.bookings.addProgressUpdate.useMutation({
    onSuccess: () => utils.bookings.progressUpdates.invalidate({ id: bookingId }),
  });
  const cancellationStatusQuery = trpc.bookings.cancellationRequestStatus.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const requestCancellationMutation = trpc.bookings.requestCancellation.useMutation();

  // Powers the customer's live tracker (src/app/booking/[id].tsx), which subscribes
  // to this same channel name and just refetches on receipt — same pattern chat uses
  // (src/app/chat/[id].tsx), client-driven rather than server-triggered. Deliberately
  // NOT done server-side (in db.ts): that was tried and reverted — awaited or not, it
  // added a real network round-trip per booking mutation and, in one isolated test,
  // even crashed the process on exit with a libuv handle-not-closed assertion. This
  // channel only needs to send, but send() requires a subscribed channel first.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase.channel(`booking-${bookingId}`).subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [bookingId]);
  const pingBookingChannel = () => {
    channelRef.current?.send({ type: "broadcast", event: "update", payload: {} });
  };

  const row = bookingQuery.data;

  const resetComposer = () => {
    setMode("idle");
    setReason("");
    setCompletionNote("");
    setCompletionPhotos([]);
    setError(null);
  };

  const runUpdate = async (status: "confirmed" | "rejected" | "in_progress" | "completed", opts?: { note?: string; completionPhotos?: string[] }) => {
    setBusy(true);
    setError(null);
    try {
      await updateStatusMutation.mutateAsync({ id: bookingId, status, note: opts?.note, completionPhotos: opts?.completionPhotos });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pingBookingChannel();
      resetComposer();
      await Promise.all([
        utils.bookings.byId.invalidate({ id: bookingId }),
        utils.bookings.history.invalidate({ id: bookingId }),
        utils.provider.bookings.invalidate(),
        utils.provider.dashboard.invalidate(),
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const submitCancellationRequest = async () => {
    if (reason.trim().length < 3) {
      setError("Please add a short reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestCancellationMutation.mutateAsync({ id: bookingId, reason: reason.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pingBookingChannel();
      resetComposer();
      await Promise.all([
        utils.bookings.cancellationRequestStatus.invalidate({ id: bookingId }),
        utils.bookings.byId.invalidate({ id: bookingId }),
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't submit request. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const confirmReleaseCode = async () => {
    setBusy(true);
    setReleaseError(null);
    try {
      const result = await confirmReleaseCodeMutation.mutateAsync({ bookingId, code: releaseCodeInput.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pingBookingChannel();
      setReleaseSuccess({ earning: result.earning });
      setReleaseCodeInput("");
      await Promise.all([
        utils.bookings.byId.invalidate({ id: bookingId }),
        utils.provider.dashboard.invalidate(),
        utils.wallet.me.invalidate(),
      ]);
    } catch (e: any) {
      setReleaseError(e?.message ?? "Incorrect code. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    Alert.alert("Accept this booking?", "You're committing to complete this job as scheduled.", [
      { text: "Cancel", style: "cancel" },
      { text: "Accept", onPress: () => runUpdate("confirmed") },
    ]);
  };

  const startJob = () => {
    Alert.alert("Start this job?", "This tells the customer you've begun work.", [
      { text: "Cancel", style: "cancel" },
      { text: "Start", onPress: () => runUpdate("in_progress") },
    ]);
  };

  const addCompletionPhoto = async () => {
    if (completionPhotos.length >= MAX_COMPLETION_PHOTOS) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: MAX_COMPLETION_PHOTOS - completionPhotos.length,
    });
    if (result.canceled || !result.assets?.length) return;
    setUploadingPhoto(true);
    try {
      for (const asset of result.assets.slice(0, MAX_COMPLETION_PHOTOS - completionPhotos.length)) {
        if (!asset.base64) continue;
        const uploaded = await uploadFileMutation.mutateAsync({
          fileName: `completion-${Date.now()}.jpg`,
          contentType: asset.mimeType ?? "image/jpeg",
          base64: asset.base64,
        });
        setCompletionPhotos((prev) => [...prev, uploaded.url]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const messageCustomer = async () => {
    if (!row) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const conversation = await startConversation.mutateAsync({ customerId: row.booking.customerId, bookingId: row.booking.id });
    router.push({ pathname: "/chat/[id]" as any, params: { id: String(conversation.id) } });
  };

  const postProgress = async (type: "on_the_way" | "arrived" | "waiting_for_customer") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await progressMutation.mutateAsync({ id: bookingId, type });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pingBookingChannel();
    } catch (e: any) {
      Alert.alert("Could not send update", e?.message ?? "Please try again.");
    }
  };

  if (bookingQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width="100%" height={40} borderRadius={12} />
          <Skeleton width="100%" height={160} borderRadius={20} />
          <Skeleton width="100%" height={100} borderRadius={20} />
        </View>
      </ScreenContainer>
    );
  }

  if (!row) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState icon="error-outline" title="Booking not found" />
        </View>
      </ScreenContainer>
    );
  }

  const { booking, service, customer, address } = row;
  const isPending = booking.status === "pending";
  const isPaid = booking.paymentStatus === "paid";
  const isTerminal = ["completed", "cancelled", "rejected"].includes(booking.status);
  const completionPhotosSaved = (booking.completionPhotos as string[] | null) ?? [];
  const payoutHeld = booking.status === "completed" && booking.payoutStatus === "held" && !releaseSuccess;
  const payoutReleased = booking.payoutStatus === "released" || !!releaseSuccess;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{booking.reference}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: mode !== "idle" ? 260 : isTerminal ? 40 : 140 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!isTerminal && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <StatusTimeline status={booking.status} progressUpdates={progressQuery.data ?? []} colors={colors} />
          </View>
        )}

        {(booking.status === "confirmed" || booking.status === "in_progress") && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground, marginBottom: 10 }}>Send an update</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {PROGRESS_TYPES.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => postProgress(p.key)}
                  disabled={progressMutation.isPending}
                  style={[styles.progressChip, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` }]}
                >
                  <MaterialIcons name={p.icon} size={15} color={colors.primary} />
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {(progressQuery.data ?? []).length > 0 && (
              <View style={{ gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                {(progressQuery.data ?? [])
                  .slice()
                  .reverse()
                  .map((p) => {
                    const meta = PROGRESS_TYPES.find((t) => t.key === p.type);
                    return (
                      <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <MaterialIcons name={meta?.icon ?? "info"} size={13} color={colors.muted} />
                        <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }}>{meta?.label ?? p.type}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{timeAgoShort(p.createdAt as any)}</Text>
                      </View>
                    );
                  })}
              </View>
            )}
          </View>
        )}

        {booking.status === "cancelled" && (
          <View style={[styles.banner, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}30` }]}>
            <MaterialIcons name="cancel" size={20} color={colors.error} />
            <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 4, textAlign: "center" }}>
              Cancelled{booking.cancelReason ? `: ${booking.cancelReason}` : ""}
            </Text>
          </View>
        )}
        {booking.status === "rejected" && (
          <View style={[styles.banner, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}30` }]}>
            <MaterialIcons name="block" size={20} color={colors.error} />
            <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 4, textAlign: "center" }}>
              You declined this request{booking.cancelReason ? `: ${booking.cancelReason}` : ""}
            </Text>
          </View>
        )}

        {/* Customer card */}
        <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {customer.avatarUrl ? (
              <Image source={{ uri: customer.avatarUrl }} style={styles.avatar} transition={200} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: `${colors.primary}18`, alignItems: "center", justifyContent: "center" }]}>
                <MaterialIcons name="person" size={22} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                {customer.name ?? "Customer"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>Booked {new Date(booking.createdAt as any).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</Text>
            </View>
            <TouchableOpacity onPress={messageCustomer} style={[styles.callBtn, { backgroundColor: `${colors.primary}14` }]} accessibilityRole="button" accessibilityLabel="Message customer">
              <MaterialIcons name="chat-bubble-outline" size={19} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Service & schedule */}
        <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground }}>{service.title}</Text>
          <View style={styles.detailRow}>
            <MaterialIcons name="event" size={16} color={colors.muted} />
            <Text style={{ fontSize: 13, color: colors.foreground }}>{formatDateTime(booking.scheduledDate, booking.scheduledTime)}</Text>
          </View>
          {address && (
            <View style={styles.detailRow}>
              <MaterialIcons name="location-on" size={16} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>
                {address.addressLine1}, {address.city}, {address.state}
              </Text>
            </View>
          )}
          {booking.notes && (
            <View style={styles.detailRow}>
              <MaterialIcons name="notes" size={16} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{booking.notes}</Text>
            </View>
          )}
        </View>

        {/* Price */}
        <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground, marginBottom: 10 }}>Price</Text>
          <View style={styles.priceRow}>
            <Text style={{ fontSize: 13, color: colors.muted }}>Subtotal</Text>
            <Text style={{ fontSize: 13, color: colors.foreground }}>{formatNaira(booking.subtotal)}</Text>
          </View>
          {parseFloat(booking.discount) > 0 && (
            <View style={styles.priceRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Discount</Text>
              <Text style={{ fontSize: 13, color: colors.success }}>-{formatNaira(booking.discount)}</Text>
            </View>
          )}
          <View style={[styles.priceRow, { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.primary }}>{formatNaira(booking.total)}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 }}>
            <MaterialIcons name={isPaid ? "check-circle" : "hourglass-empty"} size={14} color={isPaid ? colors.success : colors.warning} />
            <Text style={{ fontSize: 12, color: isPaid ? colors.success : colors.warning }}>{isPaid ? "Paid by customer" : "Awaiting customer payment"}</Text>
          </View>
        </View>

        {/* Completion photos (if job is done) */}
        {completionPhotosSaved.length > 0 && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground, marginBottom: 10 }}>Completion photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {completionPhotosSaved.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.completionPhoto} contentFit="cover" />
              ))}
            </ScrollView>
          </View>
        )}

        {payoutReleased && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: `${colors.success}12`, borderColor: colors.success }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialIcons name="check-circle" size={20} color={colors.success} />
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground }}>
                {releaseSuccess ? `You earned ₦${releaseSuccess.earning.toLocaleString()}` : "Payment released"}
              </Text>
            </View>
          </View>
        )}

        {error && mode === "idle" && <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{error}</Text>}
      </ScrollView>

      {/* Action bar */}
      {(!isTerminal || payoutHeld) && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {mode === "rejecting" ? (
            <View style={{ gap: 10 }}>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Reason for declining (optional)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              {error && <Text style={{ fontSize: 12.5, color: colors.error }}>{error}</Text>}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" onPress={resetComposer} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Decline request" variant="danger" loading={busy} onPress={() => runUpdate("rejected", { note: reason.trim() || undefined })} />
                </View>
              </View>
            </View>
          ) : mode === "cancelling" ? (
            <View style={{ gap: 10 }}>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why do you want to cancel this job?"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              {error && <Text style={{ fontSize: 12.5, color: colors.error }}>{error}</Text>}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Back" variant="secondary" onPress={resetComposer} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Submit request" variant="danger" loading={busy} onPress={submitCancellationRequest} />
                </View>
              </View>
            </View>
          ) : mode === "completing" ? (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground }}>Completion photos (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {completionPhotos.map((url) => (
                  <View key={url} style={styles.photoWrap}>
                    <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                    <TouchableOpacity onPress={() => setCompletionPhotos((p) => p.filter((u) => u !== url))} style={[styles.removeBtn, { backgroundColor: colors.error }]}>
                      <MaterialIcons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {completionPhotos.length < MAX_COMPLETION_PHOTOS && (
                  <TouchableOpacity onPress={addCompletionPhoto} disabled={uploadingPhoto} style={[styles.addPhotoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {uploadingPhoto ? <ActivityIndicator color={colors.primary} /> : <MaterialIcons name="add-a-photo" size={20} color={colors.muted} />}
                  </TouchableOpacity>
                )}
              </ScrollView>
              <TextInput
                value={completionNote}
                onChangeText={setCompletionNote}
                placeholder="Notes for this job (optional)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              {error && <Text style={{ fontSize: 12.5, color: colors.error }}>{error}</Text>}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" onPress={resetComposer} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Mark completed"
                    loading={busy}
                    onPress={() => runUpdate("completed", { note: completionNote.trim() || undefined, completionPhotos: completionPhotos.length > 0 ? completionPhotos : undefined })}
                  />
                </View>
              </View>
            </View>
          ) : isPending ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Reject" variant="secondary" onPress={() => setMode("rejecting")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Accept" loading={busy} onPress={accept} />
              </View>
            </View>
          ) : booking.status === "confirmed" ? (
            <View style={{ gap: 6 }}>
              {/* Payment now happens after acceptance — the customer pays before the
                  provider can start, not before they accept. */}
              <Button title="Start job" fullWidth loading={busy} disabled={!isPaid} onPress={startJob} />
              {!isPaid && (
                <Text style={{ fontSize: 11.5, color: colors.muted, textAlign: "center" }}>
                  Waiting for the customer to pay before you can start.
                </Text>
              )}
            </View>
          ) : booking.status === "in_progress" ? (
            <View style={{ gap: 8 }}>
              <Button title="Complete job" fullWidth onPress={() => setMode("completing")} />
              {cancellationStatusQuery.data ? (
                <Text style={{ fontSize: 11.5, color: colors.muted, textAlign: "center" }}>
                  {cancellationStatusQuery.data.requestedByUserId === booking.customerId
                    ? "The customer requested to cancel this booking — an admin is reviewing it."
                    : "Your cancellation request is awaiting admin review."}
                </Text>
              ) : (
                <TouchableOpacity onPress={() => setMode("cancelling")} style={{ alignSelf: "center", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.error }}>Request cancellation</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : payoutHeld ? (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground }}>
                Ask the customer for their job completion code
              </Text>
              <TextInput
                value={releaseCodeInput}
                onChangeText={(t) => setReleaseCodeInput(t.replace(/[^0-9]/g, "").slice(0, 5))}
                placeholder="5-digit code"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={5}
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, textAlign: "center", fontSize: 20, letterSpacing: 6, fontWeight: "800" },
                ]}
              />
              {releaseError && <Text style={{ fontSize: 12.5, color: colors.error, textAlign: "center" }}>{releaseError}</Text>}
              <Button
                title="Confirm & release payment"
                fullWidth
                loading={busy}
                disabled={releaseCodeInput.length !== 5}
                onPress={confirmReleaseCode}
              />
            </View>
          ) : null}
        </View>
      )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 8 },
  cardShadow: { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 16, alignItems: "center" },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  completionPhoto: { width: 90, height: 90, borderRadius: 12 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  progressChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  stepLine: { flex: 1, height: 2 },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  photoWrap: { width: 60, height: 60 },
  photo: { width: 60, height: 60, borderRadius: 12 },
  removeBtn: { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  addPhotoBtn: { width: 60, height: 60, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
});
