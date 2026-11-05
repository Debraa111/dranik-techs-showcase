import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export default function BookingConfirmScreen() {
  const { bookingId, paymentMethod } = useLocalSearchParams<{
    bookingId: string;
    reference?: string;
    paymentMethod?: string;
  }>();
  const colors = useColors();
  const id = Number(bookingId);
  const utils = trpc.useUtils();

  const bookingQuery = trpc.bookings.byId.useQuery({ id }, { enabled: !Number.isNaN(id) });
  const payMutation = trpc.payments.initialize.useMutation();
  const [localPaid, setLocalPaid] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const booking = bookingQuery.data?.booking;
  const service = bookingQuery.data?.service;
  const provider = bookingQuery.data?.provider;
  const method = (paymentMethod as "card" | "bank_transfer" | "wallet" | undefined) ?? "card";
  const paid = localPaid || booking?.paymentStatus === "paid";
  const isPending = booking?.status === "pending";
  const isConfirmed = booking?.status === "confirmed";
  const isDeclined = booking?.status === "rejected";
  const isCancelled = booking?.status === "cancelled";

  // Same client-driven Broadcast pattern as the tracker screen (booking/[id].tsx) —
  // this screen only needs to live-update while the customer is still sitting on it
  // right after requesting; if they leave, the tracker/notification is the fallback.
  useEffect(() => {
    if (Number.isNaN(id)) return;
    const channel = supabase
      .channel(`booking-${id}`)
      .on("broadcast", { event: "update" }, () => utils.bookings.byId.invalidate({ id }))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, utils]);

  const payNow = async () => {
    if (!booking) return;
    setPayError(null);
    try {
      const res = await payMutation.mutateAsync({
        bookingId: booking.id,
        method,
      });
      if (res.mock || res.paymentId) {
        setLocalPaid(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      setPayError(e?.message ?? "Payment could not be processed.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const header = isDeclined
    ? {
        icon: "cancel" as const,
        color: colors.error,
        title: "Request declined",
        subtitle: "The provider wasn't able to take this booking. No payment was taken.",
      }
    : isCancelled
      ? {
          icon: "cancel" as const,
          color: colors.muted,
          title: "Booking cancelled",
          subtitle: "This request is no longer active.",
        }
      : isConfirmed && paid
        ? {
            icon: "check-circle" as const,
            color: colors.success,
            title: "All set!",
            subtitle: "Your booking is confirmed and paid for.",
          }
        : isConfirmed
          ? {
              icon: "check-circle" as const,
              color: colors.success,
              title: "Request accepted!",
              subtitle: "Complete payment below to secure your booking.",
            }
          : {
              icon: "hourglass-empty" as const,
              color: colors.warning,
              title: "Booking requested!",
              subtitle: "Your request has been sent to the provider. You'll get a notification — and can pay right here — once they accept.",
            };

  const statusBadge = isDeclined
    ? { label: "Declined", color: colors.error }
    : isCancelled
      ? { label: "Cancelled", color: colors.muted }
      : isConfirmed && paid
        ? { label: "Confirmed & paid", color: colors.success }
        : isConfirmed
          ? { label: "Accepted — payment required", color: colors.warning }
          : { label: "Pending acceptance", color: colors.warning };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60, gap: 24, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={{ alignItems: "center", gap: 12, marginTop: 20 }}>
          <View style={[styles.successCircle, { backgroundColor: `${header.color}18` }]}>
            <MaterialIcons name={header.icon} size={64} color={header.color} />
          </View>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground, textAlign: "center" }}>
            {header.title}
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 21 }}>
            {header.subtitle}
          </Text>
        </View>

        {/* Receipt card */}
        {bookingQuery.isLoading ? (
          <Skeleton width="100%" height={220} borderRadius={20} />
        ) : booking ? (
          <View style={[styles.receipt, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.receiptRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Booking reference</Text>
              <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{booking.reference}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Service</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, textAlign: "right" }} numberOfLines={1}>
                {service?.title}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Provider</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{provider?.businessName}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Date &amp; time</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                {booking.scheduledDate} at {booking.scheduledTime}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Status</Text>
              <View style={[styles.statusBadge, { backgroundColor: `${statusBadge.color}20` }]}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: statusBadge.color }}>{statusBadge.label}</Text>
              </View>
            </View>
            <View style={[styles.receiptRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Service</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{formatNaira(booking.subtotal)}</Text>
            </View>
            {Number(booking.discount) > 0 && (
              <View style={styles.receiptRow}>
                <Text style={{ fontSize: 13, color: colors.muted }}>Discount</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.success }}>−{formatNaira(booking.discount)}</Text>
              </View>
            )}
            {Number(booking.platformFee) > 0 && (
              <View style={styles.receiptRow}>
                <Text style={{ fontSize: 13, color: colors.muted }}>Booking fee</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{formatNaira(booking.platformFee)}</Text>
              </View>
            )}
            <View style={[styles.receiptRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>Total</Text>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.primary }}>{formatNaira(booking.total)}</Text>
            </View>
          </View>
        ) : null}

        {/* Payment only opens up once the provider has accepted (see payments.initialize's
            own gate) — nothing to pay while still pending, declined, or cancelled. */}
        {booking && isPending && (
          <View style={[styles.waitingBanner, { backgroundColor: `${colors.warning}12`, borderColor: colors.warning }]}>
            <MaterialIcons name="hourglass-empty" size={18} color={colors.warning} />
            <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>
              No payment is needed yet — you&apos;ll be prompted here as soon as the provider accepts.
            </Text>
          </View>
        )}
        {booking && isConfirmed && (
          <View style={{ gap: 10 }}>
            {paid ? (
              <View style={[styles.paidBanner, { backgroundColor: `${colors.success}15`, borderColor: colors.success }]}>
                <MaterialIcons name="verified" size={20} color={colors.success} />
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success }}>
                  {method === "wallet" ? "Paid from wallet" : "Payment received"}
                </Text>
              </View>
            ) : (
              <>
                <Button
                  title={payMutation.isPending ? "Processing..." : `Pay ${formatNaira(booking.total)} now`}
                  size="lg"
                  fullWidth
                  loading={payMutation.isPending}
                  onPress={payNow}
                  icon={<MaterialIcons name="lock" size={16} color="#fff" />}
                />
                <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>
                  {method === "wallet"
                    ? "This will be deducted from your wallet balance."
                    : "Card and bank transfer payments run in test mode until Paystack keys are added. No real money moves."}
                </Text>
              </>
            )}
            {payError && <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{payError}</Text>}
          </View>
        )}

        <View style={{ gap: 10, marginTop: "auto" }}>
          <Button
            title="Track this booking"
            variant="tinted"
            fullWidth
            onPress={() => router.replace({ pathname: "/booking/[id]" as any, params: { id: String(booking?.id ?? id) } })}
          />
          <TouchableOpacity onPress={() => router.replace("/(tabs)/bookings" as any)} style={{ alignItems: "center", paddingVertical: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>Go to my bookings</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  successCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  receipt: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  paidBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, padding: 14 },
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
});
