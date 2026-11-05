import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

const TX_META: Record<string, { icon: any; label: string }> = {
  booking_earning: { icon: "trending-up", label: "Job earning" },
  withdrawal: { icon: "account-balance", label: "Withdrawal" },
  commission: { icon: "percent", label: "Commission" },
  refund: { icon: "undo", label: "Refund" },
  topup: { icon: "add-circle-outline", label: "Top-up" },
  booking_payment: { icon: "shopping-cart", label: "Booking payment" },
  adjustment: { icon: "tune", label: "Adjustment" },
};

export default function ProviderEarningsScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const earningsQuery = trpc.provider.earnings.useQuery(undefined, { enabled: isAuthenticated });
  const bankAccountsQuery = trpc.provider.bankAccounts.useQuery(undefined, { enabled: isAuthenticated });
  const withdrawMutation = trpc.provider.withdraw.useMutation({
    onSuccess: () => {
      utils.provider.earnings.invalidate();
      utils.provider.dashboard.invalidate();
      utils.wallet.invalidate();
    },
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accounts = bankAccountsQuery.data ?? [];
  const defaultAccount = accounts.find((a) => a.isDefault) ?? accounts[0];

  const openWithdraw = () => {
    if (!defaultAccount) {
      Alert.alert("Add a bank account first", "You need a bank account on file before you can withdraw.", [
        { text: "Cancel", style: "cancel" },
        { text: "Add bank account", onPress: () => router.push("/provider-app/bank-accounts" as any) },
      ]);
      return;
    }
    setModalOpen(true);
  };

  const submitWithdraw = async () => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n < 500) return setError("Minimum withdrawal is ₦500.");
    if (n > (earningsQuery.data?.balance ?? 0)) return setError("Amount exceeds your wallet balance.");
    setError(null);
    try {
      const result = await withdrawMutation.mutateAsync({ amount: n });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      setAmount("");
      Alert.alert("Withdrawal processed", `Your money is on its way to ${result.bankAccount} (test mode).`);
    } catch (e: any) {
      setError(e?.message ?? "Withdrawal failed. Please try again.");
    }
  };

  if (earningsQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  const data = earningsQuery.data;
  const txs = data?.transactions ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Earnings</Text>
        <View style={{ width: 36 }} />
      </View>

      <FlatList
        data={txs}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 10 }}>
            {/* Balance card */}
            <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
              <Text style={{ color: "#ffffffcc", fontSize: 13, fontWeight: "600" }}>Available balance</Text>
              <Text style={{ color: "#fff", fontSize: 34, fontWeight: "800", marginTop: 4 }}>
                {formatNaira(data?.balance ?? 0)}
              </Text>
              <TouchableOpacity
                onPress={openWithdraw}
                style={{ backgroundColor: "#fff", borderRadius: 999, paddingVertical: 12, alignItems: "center", marginTop: 14 }}
              >
                <Text style={{ color: colors.primary, fontWeight: "800" }}>Withdraw to bank</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/provider-app/bank-accounts" as any)} style={{ marginTop: 10 }}>
                <Text style={{ color: "#ffffffcc", fontSize: 11.5, textAlign: "center" }}>
                  {defaultAccount ? `Withdraws to ${defaultAccount.bankName} ****${defaultAccount.accountNumber.slice(-4)} · Manage` : "No bank account on file · Add one"}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: "#ffffffaa", fontSize: 11, marginTop: 10, lineHeight: 16 }}>
                Earnings are credited per job after the platform commission (10% by default). Open any completed
                booking to see its full breakdown.
              </Text>
            </View>

            {/* Period summary */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {[
                { label: "This week", value: data?.thisWeek ?? 0 },
                { label: "This month", value: data?.thisMonth ?? 0 },
                { label: "All time", value: data?.allTime ?? 0 },
              ].map((p) => (
                <View key={p.label} style={[styles.periodCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{p.label}</Text>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground, marginTop: 2 }}>
                    {formatNaira(p.value)}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Transactions</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="receipt-long"
            title="No transactions yet"
            description="Earnings from completed jobs will appear here."
          />
        }
        renderItem={({ item: t }) => {
          const meta = TX_META[t.category] ?? { icon: "receipt", label: t.category };
          const isCredit = t.type === "credit";
          return (
            <View style={[styles.txRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isCredit ? `${colors.success}12` : `${colors.error}10`, alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={meta.icon} size={18} color={isCredit ? colors.success : colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.foreground, fontSize: 13 }} numberOfLines={1}>
                  {t.description ?? meta.label}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  {new Date(t.createdAt as any).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                </Text>
              </View>
              <Text style={{ fontWeight: "800", color: isCredit ? colors.success : colors.foreground }}>
                {isCredit ? "+" : "−"}{formatNaira(Number(t.amount))}
              </Text>
            </View>
          );
        }}
      />

      {/* Withdraw modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Withdraw funds</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
              Available: {formatNaira(data?.balance ?? 0)} · Minimum ₦500
            </Text>
            {defaultAccount && (
              <View style={[styles.destinationRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <MaterialIcons name="account-balance" size={16} color={colors.primary} />
                <Text style={{ fontSize: 12.5, color: colors.foreground, flex: 1 }}>
                  {defaultAccount.bankName} ****{defaultAccount.accountNumber.slice(-4)}
                </Text>
              </View>
            )}
            <TextInput
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
              placeholder="Amount (₦)"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, marginTop: 14 }]}
              returnKeyType="done"
            />
            {error && <Text style={{ color: colors.error, fontSize: 13, marginTop: 8 }}>{error}</Text>}
            <View style={{ marginTop: 16 }}>
              <Button
                title={withdrawMutation.isPending ? "Processing…" : "Withdraw"}
                loading={withdrawMutation.isPending}
                onPress={submitWithdraw}
              />
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 12 }}>
              Test mode: withdrawals are simulated. Bank transfers via Paystack will be enabled at launch.
            </Text>
          </View>
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
  balanceCard: {
    borderRadius: 20,
    padding: 20,
  },
  periodCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
});
