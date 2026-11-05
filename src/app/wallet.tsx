import { useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export default function WalletScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const params = useLocalSearchParams<{ openDeposit?: string }>();

  const walletQuery = trpc.wallet.me.useQuery(undefined, { enabled: isAuthenticated });
  const txQuery = trpc.wallet.transactions.useQuery(undefined, { enabled: isAuthenticated });
  const depositMutation = trpc.wallet.deposit.useMutation();

  const [depositOpen, setDepositOpen] = useState(false);
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (params.openDeposit === "true") setDepositOpen(true);
  }, [params.openDeposit]);

  const quickAmounts = [1000, 2000, 5000, 10000];

  const onDeposit = async () => {
    const value = parseFloat(amount);
    if (Number.isNaN(value) || value < 100) {
      Alert.alert("Invalid amount", "Enter an amount of at least ₦100.");
      return;
    }
    try {
      await depositMutation.mutateAsync({ amount: value });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDepositOpen(false);
      setAmount("");
      walletQuery.refetch();
      txQuery.refetch();
    } catch (e: any) {
      Alert.alert("Deposit failed", e?.message ?? "Please try again.");
    }
  };

  const balance = walletQuery.data ? parseFloat(String(walletQuery.data.balance ?? 0)) : 0;
  const txs = txQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Wallet</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ paddingHorizontal: 20, gap: 20, flex: 1 }}>
        {/* Balance card */}
        <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.75)" }}>Available balance</Text>
          {walletQuery.isLoading ? (
            <Skeleton width={140} height={34} borderRadius={8} />
          ) : (
            <Text style={{ fontSize: 32, fontWeight: "800", color: "#fff" }}>{formatNaira(balance)}</Text>
          )}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDepositOpen(true);
            }}
            activeOpacity={0.85}
            style={styles.addMoneyBtn}
          >
            <MaterialIcons name="add" size={16} color={colors.primary} />
            <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>Add money</Text>
          </TouchableOpacity>
          <View style={[styles.infoRow, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
            <MaterialIcons name="info-outline" size={14} color="#fff" />
            <Text style={{ fontSize: 11.5, color: "#fff", flex: 1 }}>
              Refunds from cancelled bookings are credited here automatically.
            </Text>
          </View>
        </View>

        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Transaction history</Text>

        {txQuery.isLoading ? (
          <View style={{ gap: 10 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={64} borderRadius={14} />
            ))}
          </View>
        ) : txs.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <EmptyState
              icon="receipt-long"
              title="No transactions yet"
              description="Payments and refunds will appear here."
            />
          </View>
        ) : (
          <FlatList
            data={txs}
            keyExtractor={(t) => String(t.id)}
            contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: t }) => {
              const isCredit = t.type === "credit";
              return (
                <View style={[styles.txCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.txIcon, { backgroundColor: isCredit ? `${colors.success}15` : `${colors.error}12` }]}>
                    <MaterialIcons
                      name={isCredit ? "arrow-downward" : "arrow-upward"}
                      size={18}
                      color={isCredit ? colors.success : colors.error}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                      {t.description || (isCredit ? "Credit" : "Debit")}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      {new Date(t.createdAt as any).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: "800", color: isCredit ? colors.success : colors.foreground }}>
                    {isCredit ? "+" : "-"}
                    {formatNaira(t.amount)}
                  </Text>
                </View>
              );
            }}
          />
        )}
      </View>

      {/* Add money modal */}
      <Modal visible={depositOpen} animationType="slide" transparent onRequestClose={() => setDepositOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Add money</Text>
              <TouchableOpacity onPress={() => setDepositOpen(false)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="Amount (₦)"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={onDeposit}
              style={[styles.amountInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {quickAmounts.map((qa) => (
                <TouchableOpacity
                  key={qa}
                  onPress={() => setAmount(String(qa))}
                  style={[styles.quickAmount, { borderColor: amount === String(qa) ? colors.primary : colors.border, backgroundColor: amount === String(qa) ? `${colors.primary}12` : colors.surface }]}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: amount === String(qa) ? colors.primary : colors.foreground }}>
                    ₦{qa.toLocaleString("en-NG")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 11.5, color: colors.muted }}>
              Payments run in secure test mode — no real money is charged until Paystack goes live.
            </Text>
            <Button
              title={depositMutation.isPending ? "Processing..." : "Add money"}
              fullWidth
              loading={depositMutation.isPending}
              onPress={onDeposit}
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
  balanceCard: { borderRadius: 20, padding: 22, gap: 8 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, padding: 8, marginTop: 4 },
  txCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 13 },
  txIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  addMoneyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, gap: 14, paddingBottom: 40 },
  amountInput: { borderRadius: 14, borderWidth: 1.5, padding: 14, fontSize: 16, fontWeight: "700" },
  quickAmount: { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
});
