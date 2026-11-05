import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";

type ColorPalette = ReturnType<typeof useColors>;

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatDateTime(date: string, time: string) {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return `${date} · ${time}`;
  return `${d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

/**
 * 6 visual stages. Three come from the booking's own status history (a strict,
 * server-enforced linear progression); the other two ("On My Way" / "In Progress")
 * come from the P4a provider checkpoint log (`on_the_way`/`arrived`), which is a
 * free-form log a provider can post in any order, any number of times, or skip
 * entirely — not a guaranteed linear sequence. So each step lights up purely based
 * on whether ITS OWN event ever happened, in this fixed visual order, regardless of
 * the real chronological order the underlying events occurred in. A skipped
 * checkpoint (e.g. a provider who never posted "on_the_way") just stays unchecked
 * forever, even after later steps complete — we don't fabricate a checkmark for
 * something that didn't happen.
 */
type StepSource = { kind: "status"; status: string } | { kind: "checkpoint"; type: string };

const STEPS = [
  { key: "requested", label: "Requested", icon: "hourglass-empty" as const, source: { kind: "status", status: "pending" } as StepSource },
  { key: "accepted", label: "Accepted", icon: "event-available" as const, source: { kind: "status", status: "confirmed" } as StepSource },
  { key: "on_the_way", label: "On My Way", icon: "directions-car" as const, source: { kind: "checkpoint", type: "on_the_way" } as StepSource },
  { key: "started", label: "Started", icon: "play-circle-outline" as const, source: { kind: "status", status: "in_progress" } as StepSource },
  { key: "in_progress", label: "In Progress", icon: "autorenew" as const, source: { kind: "checkpoint", type: "arrived" } as StepSource },
  { key: "completed", label: "Completed", icon: "check-circle" as const, source: { kind: "status", status: "completed" } as StepSource },
];

/** Instant-cancel statuses. Once `in_progress`, cancelling is a request an admin reviews instead. */
const CANCELLABLE_STATUSES = ["pending", "confirmed"];

function StatusTimeline({
  status,
  history,
  progressUpdates,
  colors,
}: {
  status: string;
  history: { toStatus: string; createdAt: Date | string }[];
  progressUpdates: { type: string; createdAt: Date | string }[];
  colors: ColorPalette;
}) {
  if (status === "cancelled" || status === "rejected") {
    const isRejected = status === "rejected";
    return (
      <View style={[styles.cancelledBanner, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}30` }]}>
        <MaterialIcons name={isRejected ? "block" : "cancel"} size={22} color={colors.error} />
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error, marginTop: 6 }}>
          {isRejected ? "Booking declined" : "Booking cancelled"}
        </Text>
      </View>
    );
  }

  const timestamps = STEPS.map((step) => {
    const source = step.source;
    if (source.kind === "status") {
      return history.find((h) => h.toStatus === source.status)?.createdAt ?? null;
    }
    return progressUpdates.find((p) => p.type === source.type)?.createdAt ?? null;
  });
  // The active/current step is the last one (in fixed visual order) that has happened.
  let currentIndex = -1;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i]) {
      currentIndex = i;
      break;
    }
  }

  return (
    <View style={{ gap: 0 }}>
      {STEPS.map((step, i) => {
        const entryTime = timestamps[i];
        const reached = !!entryTime;
        const isCurrent = i === currentIndex;
        const isLast = i === STEPS.length - 1;
        return (
          <View key={step.key} style={{ flexDirection: "row" }}>
            <View style={{ alignItems: "center", width: 34 }}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: reached ? colors.primary : colors.surface,
                    borderColor: reached ? colors.primary : colors.border,
                  },
                ]}
              >
                <MaterialIcons name={step.icon} size={15} color={reached ? "#fff" : colors.muted} />
              </View>
              {!isLast && <View style={[styles.stepLine, { backgroundColor: i < currentIndex ? colors.primary : colors.border }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : 22, paddingTop: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: isCurrent ? "800" : "700", color: reached ? colors.foreground : colors.muted }}>
                {step.label}
              </Text>
              {entryTime && (
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
                  {new Date(entryTime).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function BookingTrackingScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const utils = trpc.useUtils();
  const [cancelling, setCancelling] = useState(false);
  const [requestingCancellation, setRequestingCancellation] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState("");
  const [submittingCancelRequest, setSubmittingCancelRequest] = useState(false);

  const bookingQuery = trpc.bookings.byId.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const historyQuery = trpc.bookings.history.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const progressQuery = trpc.bookings.progressUpdates.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const cancellationStatusQuery = trpc.bookings.cancellationRequestStatus.useQuery({ id: bookingId }, { enabled: !!bookingId });
  const cancelMutation = trpc.bookings.cancel.useMutation();
  const requestCancellationMutation = trpc.bookings.requestCancellation.useMutation();

  // Live tracker: the provider app pings this channel client-side, right after its
  // own status-update mutation succeeds (see provider-app/booking/[id].tsx's
  // pingBookingChannel) — same Broadcast pattern chat uses, not a server-triggered
  // push. Admin-driven cancellation decisions don't ping it (the admin dashboard is
  // a separate static app with no such wiring), so those only show up here on the
  // next manual refetch. The payload carries no content, only "something
  // changed" — real data always comes back through the authorized queries below.
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase
      .channel(`booking-${bookingId}`)
      .on("broadcast", { event: "update" }, () => {
        utils.bookings.byId.invalidate({ id: bookingId });
        utils.bookings.history.invalidate({ id: bookingId });
        utils.bookings.progressUpdates.invalidate({ id: bookingId });
        utils.bookings.cancellationRequestStatus.invalidate({ id: bookingId });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, utils]);

  const row = bookingQuery.data;

  const handleRequestCancellation = async () => {
    if (cancelReasonInput.trim().length < 3) {
      Alert.alert("Tell us why", "Please add a short reason (at least 3 characters).");
      return;
    }
    setSubmittingCancelRequest(true);
    try {
      await requestCancellationMutation.mutateAsync({ id: bookingId, reason: cancelReasonInput.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRequestingCancellation(false);
      setCancelReasonInput("");
      await Promise.all([
        utils.bookings.cancellationRequestStatus.invalidate({ id: bookingId }),
        utils.bookings.byId.invalidate({ id: bookingId }),
      ]);
    } catch (e: any) {
      Alert.alert("Couldn't submit request", e?.message ?? "Please try again.");
    } finally {
      setSubmittingCancelRequest(false);
    }
  };

  const payoutHeld = row?.booking.status === "completed" && row?.booking.payoutStatus === "held";
  const releaseCodeQuery = trpc.bookings.releaseCode.useQuery({ id: bookingId }, { enabled: payoutHeld });

  // The durable "pay now" surface. booking/confirm.tsx only exists in the single
  // moment right after a request is submitted — once the customer leaves it (very
  // likely, since there's no time limit on a provider's response), this tracker
  // screen is the only other place to pay once accepted, so it needs its own flow
  // rather than pointing back at confirm.tsx.
  const payMutation = trpc.payments.initialize.useMutation();
  const [payError, setPayError] = useState<string | null>(null);
  const needsPayment = row?.booking.status === "confirmed" && row.booking.paymentStatus !== "paid";
  const handlePayNow = async () => {
    if (!row) return;
    setPayError(null);
    try {
      await payMutation.mutateAsync({ bookingId: row.booking.id, method: "card" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.bookings.byId.invalidate({ id: bookingId });
    } catch (e: any) {
      setPayError(e?.message ?? "Payment could not be processed.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleCancel = () => {
    Alert.alert("Cancel booking", "Are you sure you want to cancel this booking?", [
      { text: "Keep booking", style: "cancel" },
      {
        text: "Cancel booking",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelMutation.mutateAsync({ id: bookingId });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await Promise.all([utils.bookings.byId.invalidate({ id: bookingId }), utils.bookings.history.invalidate({ id: bookingId }), utils.bookings.mine.invalidate()]);
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e?.message ?? "Please try again.");
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  // No direct phone calling, ever — the provider's number is never sent to the
  // client (see publicProviderColumns in server/db.ts). Messaging stays available
  // both before and after acceptance; a real in-app voice call for accepted
  // bookings is tracked separately pending a voice-infrastructure decision.
  const startConversation = trpc.messages.start.useMutation();
  const handleMessage = async () => {
    if (!row) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const conversation = await startConversation.mutateAsync({
      providerId: row.provider.id,
      bookingId: row.booking.id,
    });
    router.push({ pathname: "/chat/[id]" as any, params: { id: String(conversation.id) } });
  };

  if (bookingQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width="100%" height={40} borderRadius={12} />
          <Skeleton width="100%" height={180} borderRadius={20} />
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
          <EmptyState icon="error-outline" title="Booking not found" description="This booking may have been removed." />
        </View>
      </ScreenContainer>
    );
  }

  const { booking, service, provider, address } = row;
  const canCancel = CANCELLABLE_STATUSES.includes(booking.status);

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

      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Timeline card */}
        <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.foreground, marginBottom: 14 }}>Status</Text>
          {historyQuery.isLoading ? (
            <Skeleton width="100%" height={140} borderRadius={12} />
          ) : (
            <StatusTimeline
              status={booking.status}
              history={historyQuery.data ?? []}
              progressUpdates={progressQuery.data ?? []}
              colors={colors}
            />
          )}
          {booking.status === "cancelled" && booking.cancelReason && (
            <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 8 }}>Reason: {booking.cancelReason}</Text>
          )}
        </View>

        {/* Pay now — payment only opens up once the provider has accepted (see
            payments.initialize's own gate); this is the primary place to pay from
            once the customer has left the one-shot confirm.tsx screen. */}
        {needsPayment && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}30` }]}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
              Accepted — payment required
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.muted, marginBottom: 12 }}>
              The provider has accepted your request. Pay now to secure your booking.
            </Text>
            <Button
              title={payMutation.isPending ? "Processing..." : `Pay ${formatNaira(booking.total)} now`}
              fullWidth
              loading={payMutation.isPending}
              onPress={handlePayNow}
              icon={<MaterialIcons name="lock" size={16} color="#fff" />}
            />
            {payError && <Text style={{ fontSize: 12.5, color: colors.error, textAlign: "center", marginTop: 8 }}>{payError}</Text>}
          </View>
        )}

        {/* Provider card */}
        <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[styles.providerAvatar, { backgroundColor: `${colors.primary}18` }]}>
              <MaterialIcons name="storefront" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                  {provider.businessName}
                </Text>
                {provider.verificationStatus === "verified" && <MaterialIcons name="verified" size={15} color={colors.primary} />}
              </View>
              <Text style={{ fontSize: 12, color: colors.muted }}>{provider.city}, {provider.state}</Text>
            </View>
            <TouchableOpacity
              onPress={handleMessage}
              disabled={startConversation.isPending}
              style={[styles.callBtn, { backgroundColor: `${colors.primary}14` }]}
              accessibilityRole="button"
              accessibilityLabel="Message provider"
            >
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

        {/* Price breakdown */}
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
          {parseFloat(booking.platformFee) > 0 && (
            <View style={styles.priceRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Booking fee</Text>
              <Text style={{ fontSize: 13, color: colors.foreground }}>{formatNaira(booking.platformFee)}</Text>
            </View>
          )}
          <View style={[styles.priceRow, { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.primary }}>{formatNaira(booking.total)}</Text>
          </View>
        </View>

        {/* Actions */}
        {canCancel && (
          <Button title="Cancel booking" variant="danger" loading={cancelling} onPress={handleCancel} />
        )}
        {booking.status === "in_progress" && cancellationStatusQuery.data && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: `${colors.warning}10`, borderColor: `${colors.warning}40` }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialIcons name="hourglass-top" size={18} color={colors.warning} />
              <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.foreground }}>Cancellation requested</Text>
            </View>
            <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 18 }}>
              {cancellationStatusQuery.data.requestedByUserId === user?.id
                ? "You requested to cancel this booking."
                : "Your provider requested to cancel this booking."}{" "}
              An admin is reviewing it — the booking stays active until then.
            </Text>
          </View>
        )}
        {booking.status === "in_progress" && !cancellationStatusQuery.data && requestingCancellation && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.foreground }}>Why do you want to cancel?</Text>
            <TextInput
              value={cancelReasonInput}
              onChangeText={setCancelReasonInput}
              placeholder="Tell us what happened"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Back"
                  variant="secondary"
                  onPress={() => {
                    setRequestingCancellation(false);
                    setCancelReasonInput("");
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Submit request" variant="danger" loading={submittingCancelRequest} onPress={handleRequestCancellation} />
              </View>
            </View>
          </View>
        )}
        {booking.status === "in_progress" && !cancellationStatusQuery.data && !requestingCancellation && (
          <Button title="Request cancellation" variant="danger" onPress={() => setRequestingCancellation(true)} />
        )}
        {payoutHeld && releaseCodeQuery.data && (
          <View style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1.5 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialIcons name="lock-clock" size={20} color={colors.primary} />
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.foreground }}>Job completion code</Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
              Give this code to your provider once you're happy with the job — entering it releases your payment to them.
            </Text>
            <Text
              style={{
                fontSize: 36,
                fontWeight: "800",
                color: colors.primary,
                letterSpacing: 8,
                textAlign: "center",
                marginVertical: 4,
              }}
            >
              {releaseCodeQuery.data.code}
            </Text>
          </View>
        )}
        {booking.status === "completed" && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Leave review"
                variant="tinted"
                onPress={() => router.push({ pathname: "/booking/review" as any, params: { bookingId: String(booking.id) } })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Rebook" onPress={() => router.push({ pathname: "/service/[id]" as any, params: { id: String(service.id) } })} />
            </View>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 8 },
  cardShadow: { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepLine: { width: 2, flex: 1, marginVertical: 2 },
  cancelledBanner: { borderWidth: 1, borderRadius: 14, padding: 16, alignItems: "center" },
  providerAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 70, textAlignVertical: "top" },
});
