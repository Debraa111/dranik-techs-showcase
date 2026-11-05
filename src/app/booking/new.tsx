import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/** Next 14 days as selectable dates. */
function buildDates() {
  const out: { iso: string; dayName: string; dayNum: number; month: string }[] = [];
  const fmtDay = new Intl.DateTimeFormat("en-NG", { weekday: "short" });
  const fmtMonth = new Intl.DateTimeFormat("en-NG", { month: "short" });
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({
      iso: d.toISOString().slice(0, 10),
      dayName: i === 0 ? "Today" : i === 1 ? "Tmrw" : fmtDay.format(d),
      dayNum: d.getDate(),
      month: fmtMonth.format(d),
    });
  }
  return out;
}

/** Mirrors BOOKING_MIN_LEAD_MS in server/db.ts — kept in sync manually, since this
 *  screen can't import server code (it would pull DB drivers into the mobile bundle).
 *  A slot must start at least this far out to be selectable; bookings.create rejects
 *  anything closer server-side too, so this is UX, not the real enforcement. */
const BOOKING_MIN_LEAD_MS = 60 * 60 * 1000;

/** Nigeria is a fixed UTC+1 offset year-round — same math as scheduledAtUtc in
 *  server/db.ts, just run client-side against the device's own clock. */
function slotStartsAt(dateIso: string, time: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
}
const PAYMENT_METHODS = [
  { id: "card", label: "Card (Paystack)", icon: "credit-card" as const },
  { id: "bank_transfer", label: "Bank transfer", icon: "account-balance" as const },
  { id: "wallet", label: "Wallet", icon: "account-balance-wallet" as const },
];

export default function NewBookingScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const colors = useColors();
  const utils = trpc.useUtils();

  const dates = useMemo(buildDates, []);
  const [selectedDate, setSelectedDate] = useState(dates[0].iso);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const isTimeSlotDisabled = (dateIso: string, time: string) =>
    slotStartsAt(dateIso, time).getTime() < Date.now() + BOOKING_MIN_LEAD_MS;
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detailQuery = trpc.services.byId.useQuery(
    { id: Number(serviceId) },
    { enabled: Boolean(serviceId) },
  );
  const addressesQuery = trpc.addresses.list.useQuery();
  const walletQuery = trpc.wallet.me.useQuery();
  const bookingFeeQuery = trpc.config.bookingFee.useQuery();
  const createBooking = trpc.bookings.create.useMutation();

  const providerId = detailQuery.data?.provider.id;
  const slotsQuery = trpc.bookings.availableSlots.useQuery(
    { providerId: providerId ?? 0, date: selectedDate },
    { enabled: Boolean(providerId) },
  );
  const timeSlots = slotsQuery.data ?? [];

  // Covers both switching to a closed/blocked day and the provider's hours simply
  // not including the previously-picked time — the lead-time check in the date
  // chip's onPress below only catches the "still open, just too soon now" case.
  useEffect(() => {
    if (selectedTime && slotsQuery.data && !slotsQuery.data.includes(selectedTime)) {
      setSelectedTime(null);
    }
  }, [selectedDate, slotsQuery.data]);

  const service = detailQuery.data?.service;
  const subtotal = service ? parseFloat(service.basePrice) : 0;
  const discount = couponApplied?.discount ?? 0;
  // Display only — the server independently computes and freezes its own fee at
  // booking-creation time (see bookings.create), so this can't be used to under-pay.
  const bookingFee = bookingFeeQuery.data?.enabled ? bookingFeeQuery.data.amount : 0;
  const total = Math.max(0, subtotal - discount) + bookingFee;

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code || !service) return;
    setCouponError(null);
    try {
      const res = await utils.coupons.validate.fetch({ code, orderAmount: subtotal || 0 });
      if (res.valid) {
        setCouponApplied({ code, discount: res.discount });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setCouponApplied(null);
        setCouponError(res.reason ?? "Invalid coupon");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e: any) {
      setCouponApplied(null);
      setCouponError(e?.message ?? "Invalid coupon");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const submit = async () => {
    if (!service || !selectedTime) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createBooking.mutateAsync({
        serviceId: service.id,
        scheduledDate: selectedDate,
        scheduledTime: selectedTime,
        addressId: selectedAddressId ?? undefined,
        notes: notes.trim() || undefined,
        couponCode: couponApplied?.code,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({
        pathname: "/booking/confirm" as any,
        params: { bookingId: String(res.id), reference: res.reference, paymentMethod },
      });
    } catch (e: any) {
      setSubmitError(e?.message ?? "Could not create booking. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Book service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 22 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Service summary */}
        {detailQuery.isLoading ? (
          <Skeleton width="100%" height={70} borderRadius={16} />
        ) : service ? (
          <View style={[styles.serviceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.serviceIcon, { backgroundColor: `${colors.primary}12` }]}>
              <MaterialIcons name="handyman" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                {service.title}
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                {detailQuery.data?.provider?.businessName}
              </Text>
            </View>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.primary }}>
              {formatNaira(subtotal)}
            </Text>
          </View>
        ) : null}

        {/* Date */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Choose date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {dates.map((d) => {
              const active = d.iso === selectedDate;
              return (
                <TouchableOpacity
                  key={d.iso}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedDate(d.iso);
                    // A time chosen for a different date can be too-soon/past for
                    // this one (only matters switching onto today, but re-checking
                    // unconditionally is simpler than special-casing that).
                    if (selectedTime && isTimeSlotDisabled(d.iso, selectedTime)) setSelectedTime(null);
                  }}
                  style={[
                    styles.dateChip,
                    {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: active ? "#fff" : colors.muted }}>
                    {d.dayName}
                  </Text>
                  <Text style={{ fontSize: 17, fontWeight: "800", color: active ? "#fff" : colors.foreground }}>
                    {d.dayNum}
                  </Text>
                  <Text style={{ fontSize: 10, color: active ? "#fff" : colors.muted }}>{d.month}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Time */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Choose time</Text>
          {slotsQuery.isLoading ? (
            <Skeleton width="100%" height={38} borderRadius={12} />
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {timeSlots.map((t) => {
                  const active = t === selectedTime;
                  const disabled = isTimeSlotDisabled(selectedDate, t);
                  return (
                    <TouchableOpacity
                      key={t}
                      disabled={disabled}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedTime(t);
                      }}
                      style={[
                        styles.timeChip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                          opacity: disabled ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "700", color: active ? "#fff" : disabled ? colors.muted : colors.foreground }}>
                        {t}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {timeSlots.length === 0 && (
                <Text style={{ fontSize: 12.5, color: colors.muted }}>
                  This provider isn't available on this date — try another day.
                </Text>
              )}
              {timeSlots.length > 0 && timeSlots.every((t) => isTimeSlotDisabled(selectedDate, t)) && (
                <Text style={{ fontSize: 12.5, color: colors.muted }}>
                  No times left today — try tomorrow or a later date.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Address */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Service address</Text>
            <TouchableOpacity onPress={() => router.push("/addresses" as any)}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>+ Add new</Text>
            </TouchableOpacity>
          </View>
          {(addressesQuery.data ?? []).length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.muted }}>
              No saved addresses — you can add one from your profile, or the provider will contact you to confirm the location.
            </Text>
          ) : (
            (addressesQuery.data ?? []).map((a) => {
              const active = a.id === selectedAddressId;
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedAddressId(active ? null : a.id);
                  }}
                  style={[
                    styles.addressRow,
                    {
                      backgroundColor: colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <MaterialIcons name={active ? "radio-button-checked" : "radio-button-unchecked"} size={20} color={active ? colors.primary : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                      {a.label || "Address"}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                      {a.addressLine1}, {a.city}, {a.state}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Notes */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything the provider should know?"
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="done"
            style={[styles.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        {/* Coupon */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Coupon code</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={couponCode}
              onChangeText={(t) => {
                setCouponCode(t);
                setCouponError(null);
              }}
              placeholder="e.g. WELCOME20"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={applyCoupon}
              style={[styles.couponInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Apply" variant="tinted" onPress={applyCoupon} />
          </View>
          {couponApplied && (
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.success }}>
              ✓ {couponApplied.code} applied — you save {formatNaira(couponApplied.discount)}
            </Text>
          )}
          {couponError && (
            <Text style={{ fontSize: 13, color: colors.error }}>{couponError}</Text>
          )}
        </View>

        {/* Payment method */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment method</Text>
          {PAYMENT_METHODS.map((m) => {
            const active = m.id === paymentMethod;
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPaymentMethod(m.id);
                }}
                style={[
                  styles.addressRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    borderWidth: active ? 2 : 1,
                  },
                ]}
              >
                <MaterialIcons name={m.icon} size={20} color={active ? colors.primary : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{m.label}</Text>
                  {m.id === "wallet" && walletQuery.data && (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                      Balance: {formatNaira(parseFloat(walletQuery.data.balance))}
                    </Text>
                  )}
                </View>
                <MaterialIcons name={active ? "radio-button-checked" : "radio-button-unchecked"} size={20} color={active ? colors.primary : colors.muted} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Price summary */}
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 4 }]}>Booking summary</Text>
          <View style={styles.summaryRow}>
            <Text style={{ fontSize: 14, color: colors.muted }}>Subtotal</Text>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{formatNaira(subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={{ fontSize: 14, color: colors.muted }}>Discount</Text>
            <Text style={{ fontSize: 14, fontWeight: "600", color: discount > 0 ? colors.success : colors.foreground }}>
              −{formatNaira(discount)}
            </Text>
          </View>
          {bookingFee > 0 && (
            <View style={styles.summaryRow}>
              <Text style={{ fontSize: 14, color: colors.muted }}>Booking fee</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{formatNaira(bookingFee)}</Text>
            </View>
          )}
          <View style={[styles.summaryRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 }]}>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>Total</Text>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.primary }}>{formatNaira(total)}</Text>
          </View>
        </View>

        {submitError && (
          <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{submitError}</Text>
        )}
      </ScrollView>

      {/* Sticky confirm bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Button
          title={submitting ? "Booking..." : selectedTime ? `Confirm booking · ${formatNaira(total)}` : "Select a time to continue"}
          size="lg"
          fullWidth
          disabled={!selectedTime || submitting || !service}
          loading={submitting}
          onPress={submit}
        />
      </View>
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
    paddingVertical: 10,
  },
  topTitle: { fontSize: 16, fontWeight: "700" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  serviceCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  serviceIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  dateChip: { width: 62, paddingVertical: 10, borderRadius: 14, borderWidth: 1, alignItems: "center", gap: 2 },
  timeChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 14 },
  notesInput: { borderRadius: 14, borderWidth: 1, padding: 14, minHeight: 80, fontSize: 14, textAlignVertical: "top" },
  couponInput: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
  },
});
