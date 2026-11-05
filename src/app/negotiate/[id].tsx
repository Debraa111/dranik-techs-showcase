import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";

type ColorPalette = ReturnType<typeof useColors>;
type Offer = { byRole: string; amount: string; note: string | null; status: string; expiresAt: string | Date | null; createdAt: string | Date };

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Awaiting response", tone: "neutral" },
  negotiating: { label: "Negotiating", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

function OfferBubble({ offer, mine, colors }: { offer: Offer; mine: boolean; colors: ColorPalette }) {
  const isSuperseded = offer.status === "countered" || offer.status === "rejected" || offer.status === "expired";
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
            : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
          isSuperseded && { opacity: 0.55 },
        ]}
      >
        <Text style={{ fontSize: 10.5, fontWeight: "700", color: mine ? "#ffffffcc" : colors.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {offer.byRole === "customer" ? "Your offer" : "Provider's offer"}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: "800", color: mine ? "#fff" : colors.foreground, marginTop: 2 }}>
          {formatNaira(offer.amount)}
        </Text>
        {offer.note && (
          <Text style={{ fontSize: 13, color: mine ? "#ffffffdd" : colors.foreground, marginTop: 4 }}>{offer.note}</Text>
        )}
        {offer.status === "pending" && offer.expiresAt && (
          <Text style={{ fontSize: 10.5, color: mine ? "#ffffffaa" : colors.muted, marginTop: 4 }}>
            Expires {new Date(offer.expiresAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </Text>
        )}
      </View>
      <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 3, marginHorizontal: 4 }}>
        {timeAgo(offer.createdAt)}
        {isSuperseded ? ` · ${offer.status}` : ""}
      </Text>
    </View>
  );
}

export default function NegotiationDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const negotiationId = Number(id);
  const utils = trpc.useUtils();

  const [countering, setCountering] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQuery = trpc.negotiations.byId.useQuery({ id: negotiationId }, { enabled: !!negotiationId, refetchInterval: 20000 });
  const offerMutation = trpc.negotiations.offer.useMutation();
  const acceptMutation = trpc.negotiations.accept.useMutation();
  const closeMutation = trpc.negotiations.close.useMutation();

  useEffect(() => {
    if (!negotiationId) return;
    const channel = supabase
      .channel(`negotiation-${negotiationId}`)
      .on("broadcast", { event: "update" }, () => {
        utils.negotiations.byId.invalidate({ id: negotiationId });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [negotiationId, utils.negotiations.byId]);

  const broadcast = () => {
    supabase.channel(`negotiation-${negotiationId}`).send({ type: "broadcast", event: "update", payload: {} });
  };

  const row = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width="100%" height={60} borderRadius={16} />
          <Skeleton width="100%" height={140} borderRadius={16} />
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
          <EmptyState icon="sync-alt" title="Negotiation not found" />
        </View>
      </ScreenContainer>
    );
  }

  const { negotiation, offers, viewerRole } = row;
  const isCustomer = viewerRole === "customer";
  const isTerminal = ["accepted", "rejected", "expired", "cancelled"].includes(negotiation.status);
  const isActive = !isTerminal;
  const pendingOffer = offers.find((o) => o.status === "pending");
  const myTurn = isActive && (!!pendingOffer ? pendingOffer.byRole !== viewerRole : true);
  const statusMeta = STATUS_META[negotiation.status] ?? { label: negotiation.status, tone: "neutral" as BadgeTone };
  const originalPrice = row.serviceBasePrice ? parseFloat(row.serviceBasePrice) : null;
  const photos = (negotiation.photos as string[] | null) ?? [];

  const runMutation = async (fn: () => Promise<any>, successHaptic = true) => {
    setError(null);
    try {
      await fn();
      if (successHaptic) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      broadcast();
      utils.negotiations.byId.invalidate({ id: negotiationId });
      if (isCustomer) utils.negotiations.mine.invalidate();
      else utils.negotiations.forProvider.invalidate();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const sendOffer = async () => {
    const value = Number(amount.trim());
    if (!value || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    await runMutation(async () => {
      await offerMutation.mutateAsync({ negotiationId, amount: value, note: note.trim() || undefined });
    });
    setAmount("");
    setNote("");
    setCountering(false);
  };

  const accept = () => {
    Alert.alert(
      "Accept this offer?",
      `This locks the price at ${formatNaira(pendingOffer?.amount ?? "0")} and creates a confirmed booking.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Accept Offer",
          onPress: () =>
            runMutation(async () => {
              const result = await acceptMutation.mutateAsync({ negotiationId });
              router.replace({ pathname: "/booking/[id]" as any, params: { id: String(result.bookingId) } });
            }),
        },
      ],
    );
  };

  const rejectOrWithdraw = () => {
    Alert.alert(
      isCustomer ? "Withdraw this offer?" : "Reject this offer?",
      "This ends the negotiation. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isCustomer ? "Withdraw" : "Reject Offer",
          style: "destructive",
          onPress: () => runMutation(async () => closeMutation.mutateAsync({ negotiationId })),
        },
      ],
    );
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{negotiation.reference}</Text>
          <Badge label={statusMeta.label} tone={statusMeta.tone} />
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: isActive ? 160 : 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Counterpart + service */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {isCustomer ? (
              <View style={[styles.avatar, { backgroundColor: `${colors.primary}18` }]}>
                <MaterialIcons name="storefront" size={22} color={colors.primary} />
              </View>
            ) : row.customerAvatar ? (
              <Image source={{ uri: row.customerAvatar }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: `${colors.primary}18` }]}>
                <MaterialIcons name="person" size={22} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                {isCustomer ? row.providerBusinessName : (row.customerName ?? "Customer")}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={1}>
                {row.serviceTitle}
              </Text>
            </View>
          </View>
          {originalPrice !== null && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>Original Price</Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{formatNaira(originalPrice)}</Text>
            </View>
          )}
        </View>

        {(negotiation.description || photos.length > 0) && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {negotiation.description && (
              <Text style={{ fontSize: 13.5, color: colors.foreground, lineHeight: 20 }}>{negotiation.description}</Text>
            )}
            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: negotiation.description ? 10 : 0 }}>
                {photos.map((url) => (
                  <Image key={url} source={{ uri: url }} style={styles.photo} contentFit="cover" />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Negotiation history */}
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>Offers</Text>
          {offers.map((o) => (
            <OfferBubble key={o.id} offer={o as any} mine={o.byRole === viewerRole} colors={colors} />
          ))}
        </View>

        {/* Outcome */}
        {negotiation.status === "accepted" && (
          <View style={[styles.outcomeCard, { backgroundColor: `${colors.success}12`, borderColor: `${colors.success}40` }]}>
            <MaterialIcons name="check-circle" size={22} color={colors.success} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginTop: 6 }}>
              Accepted at {formatNaira(negotiation.agreedPrice ?? "0")}
            </Text>
            {originalPrice !== null && negotiation.agreedPrice && parseFloat(negotiation.agreedPrice) < originalPrice && (
              <Text style={{ fontSize: 12.5, color: colors.success, marginTop: 2 }}>
                {formatNaira(originalPrice - parseFloat(negotiation.agreedPrice))} off the original price
              </Text>
            )}
            {negotiation.bookingId && (
              <View style={{ marginTop: 10 }}>
                <Button title="View booking" size="sm" onPress={() => router.push({ pathname: "/booking/[id]" as any, params: { id: String(negotiation.bookingId) } })} />
              </View>
            )}
          </View>
        )}
        {(negotiation.status === "rejected" || negotiation.status === "cancelled" || negotiation.status === "expired") && (
          <View style={[styles.outcomeCard, { backgroundColor: `${colors.muted}12`, borderColor: colors.border }]}>
            <MaterialIcons name={negotiation.status === "expired" ? "hourglass-disabled" : "cancel"} size={22} color={colors.muted} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginTop: 6 }}>
              {negotiation.status === "rejected" ? "Rejected by the provider" : negotiation.status === "cancelled" ? "Withdrawn by the customer" : "This offer expired"}
            </Text>
          </View>
        )}

        {error && <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{error}</Text>}
      </ScrollView>

      {isActive && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {countering ? (
            <View style={{ gap: 10 }}>
              <View style={[styles.amountInput, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted }}>₦</Text>
                <TextInput
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                  placeholder="Amount"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  autoFocus
                  style={{ flex: 1, fontSize: 15, color: colors.foreground, paddingVertical: 10 }}
                />
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a message (optional)"
                placeholderTextColor={colors.muted}
                style={[styles.noteInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" onPress={() => setCountering(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={isCustomer ? "Send Offer" : "Send Counter"} loading={offerMutation.isPending} onPress={sendOffer} />
                </View>
              </View>
            </View>
          ) : myTurn && pendingOffer ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title={isCustomer ? "Reject" : "Reject Offer"} variant="secondary" onPress={rejectOrWithdraw} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={isCustomer ? "Make Another Offer" : "Counter Offer"} variant="tinted" onPress={() => setCountering(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Accept Offer" loading={acceptMutation.isPending} onPress={accept} />
              </View>
            </View>
          ) : myTurn ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title={isCustomer ? "Withdraw" : "Reject"} variant="secondary" onPress={rejectOrWithdraw} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Send an offer" onPress={() => setCountering(true)} />
              </View>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                Waiting for {isCustomer ? "the provider" : "the customer"} to respond.
              </Text>
              <Button title={isCustomer ? "Withdraw offer" : "Reject offer"} variant="secondary" size="sm" onPress={rejectOrWithdraw} />
            </View>
          )}
        </View>
      )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 18, borderWidth: 1, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  photo: { width: 90, height: 90, borderRadius: 12 },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  outcomeCard: { borderRadius: 16, borderWidth: 1, padding: 16, alignItems: "center" },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1 },
  amountInput: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14 },
  noteInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
});
