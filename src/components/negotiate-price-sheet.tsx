import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { Button } from "@/components/ui/button";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/**
 * "Negotiate Price" bottom sheet — the opening move of a negotiation.
 * Deliberately just three fields (original price, your offer, optional
 * message) so it feels like haggling on a price, not filling out a job
 * request form. On success it closes and hands off to the negotiation
 * thread screen for the back-and-forth.
 */
export function NegotiatePriceSheet({
  visible,
  onClose,
  providerId,
  serviceId,
  serviceTitle,
  originalPrice,
}: {
  visible: boolean;
  onClose: () => void;
  providerId: number;
  serviceId: number;
  serviceTitle: string;
  originalPrice: string | number;
}) {
  const colors = useColors();
  const startMutation = trpc.negotiations.start.useMutation();

  const [offer, setOffer] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOffer("");
    setMessage("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const sendOffer = async () => {
    const amount = Number(offer.trim());
    if (!amount || amount <= 0) {
      setError("Enter how much you'd like to offer.");
      return;
    }
    setError(null);
    try {
      const result = await startMutation.mutateAsync({
        providerId,
        serviceId,
        offerAmount: amount,
        message: message.trim() || undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
      router.push({ pathname: "/negotiate/[id]" as any, params: { id: String(result.id) } });
    } catch (e: any) {
      setError(e?.message ?? "Could not send your offer. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={handleClose} />
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Negotiate Price</Text>
              <TouchableOpacity onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
              {serviceTitle}
            </Text>

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>Original Price</Text>
              <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>{formatNaira(originalPrice)}</Text>
            </View>

            <View style={{ marginTop: 16, gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Your Offer</Text>
              <View style={[styles.amountInput, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.muted }}>₦</Text>
                <TextInput
                  value={offer}
                  onChangeText={(t) => setOffer(t.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 8000"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  autoFocus
                  style={{ flex: 1, fontSize: 16, color: colors.foreground, paddingVertical: 12 }}
                />
              </View>
            </View>

            <View style={{ marginTop: 14, gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Message (optional)</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={`Can you do this for ${offer ? formatNaira(offer) : "this price"}?`}
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.messageInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>

            {error && <Text style={{ fontSize: 13, color: colors.error, marginTop: 10, textAlign: "center" }}>{error}</Text>}

            <View style={{ marginTop: 18 }}>
              <Button
                title="Send Offer"
                loadingText="Sending..."
                size="lg"
                fullWidth
                loading={startMutation.isPending}
                disabled={!offer.trim() || startMutation.isPending}
                onPress={sendOffer}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  amountInput: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14 },
  messageInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 60, textAlignVertical: "top" },
});
