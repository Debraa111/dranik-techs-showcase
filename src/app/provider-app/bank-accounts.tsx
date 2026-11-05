import { useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

/** Major Nigerian banks with CBN codes — ready for real Paystack Transfer Recipient lookups later. */
const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "Zenith Bank", code: "057" },
  { name: "Guaranty Trust Bank (GTBank)", code: "058" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "United Bank for Africa (UBA)", code: "033" },
  { name: "Fidelity Bank", code: "070" },
  { name: "Union Bank", code: "032" },
  { name: "Sterling Bank", code: "232" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Wema Bank", code: "035" },
  { name: "Polaris Bank", code: "076" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Opay", code: "999992" },
  { name: "PalmPay", code: "999991" },
  { name: "Moniepoint", code: "50515" },
];

function maskAccountNumber(n: string) {
  return `****${n.slice(-4)}`;
}

export default function ProviderBankAccountsScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const accountsQuery = trpc.provider.bankAccounts.useQuery(undefined, { enabled: isAuthenticated });
  const addMutation = trpc.provider.addBankAccount.useMutation({
    onSuccess: () => utils.provider.bankAccounts.invalidate(),
  });
  const removeMutation = trpc.provider.removeBankAccount.useMutation({
    onSuccess: () => utils.provider.bankAccounts.invalidate(),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [bank, setBank] = useState<(typeof NIGERIAN_BANKS)[number] | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accounts = accountsQuery.data ?? [];

  const resetForm = () => {
    setBank(null);
    setAccountNumber("");
    setAccountName("");
    setMakeDefault(true);
    setError(null);
  };

  const submit = async () => {
    if (!bank) return setError("Choose your bank.");
    if (accountNumber.trim().length < 6) return setError("Enter a valid account number.");
    if (accountName.trim().length < 2) return setError("Enter the account holder's name.");
    setError(null);
    setSaving(true);
    try {
      await addMutation.mutateAsync({
        bankName: bank.name,
        bankCode: bank.code,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        isDefault: makeDefault,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      resetForm();
    } catch (e: any) {
      setError(e?.message ?? "Could not save this account. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = (accountId: number, label: string) => {
    Alert.alert("Remove bank account?", `"${label}" will no longer be available for withdrawals.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeMutation.mutate({ accountId }) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/provider-app/dashboard" as any))}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Bank accounts</Text>
        <TouchableOpacity
          onPress={() => {
            resetForm();
            setModalOpen(true);
          }}
          style={[styles.iconBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {accountsQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={90} borderRadius={16} />
          ))}
        </View>
      ) : accounts.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="account-balance"
            title="No bank account yet"
            description="Add a bank account so you can withdraw your earnings."
            actionLabel="Add bank account"
            onAction={() => {
              resetForm();
              setModalOpen(true);
            }}
          />
        </View>
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          renderItem={({ item: a }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
                  <MaterialIcons name="account-balance" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontWeight: "800", color: colors.foreground, fontSize: 14.5 }} numberOfLines={1}>
                      {a.bankName}
                    </Text>
                    {a.isDefault && <Badge label="Default" tone="success" />}
                  </View>
                  <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>
                    {a.accountName} · {maskAccountNumber(a.accountNumber)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => confirmRemove(a.id, a.bankName)} hitSlop={8}>
                  <MaterialIcons name="delete-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Add bank account</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ gap: 6, marginTop: 16 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Bank *</Text>
              <TouchableOpacity
                onPress={() => setBankPickerOpen(!bankPickerOpen)}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
              >
                <Text style={{ color: bank ? colors.foreground : colors.muted }}>{bank?.name ?? "Select your bank"}</Text>
                <MaterialIcons name={bankPickerOpen ? "expand-less" : "expand-more"} size={20} color={colors.muted} />
              </TouchableOpacity>
              {bankPickerOpen && (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, maxHeight: 220, overflow: "hidden" }}>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                    {NIGERIAN_BANKS.map((b) => (
                      <TouchableOpacity
                        key={b.code}
                        onPress={() => {
                          setBank(b);
                          setBankPickerOpen(false);
                        }}
                        style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: b.code === bank?.code ? `${colors.primary}12` : colors.surface }}
                      >
                        <Text style={{ color: b.code === bank?.code ? colors.primary : colors.foreground, fontWeight: b.code === bank?.code ? "700" : "400" }}>{b.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={{ gap: 6, marginTop: 14 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Account number *</Text>
              <TextInput
                value={accountNumber}
                onChangeText={(t) => setAccountNumber(t.replace(/[^0-9]/g, ""))}
                placeholder="10-digit NUBAN"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={10}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>

            <View style={{ gap: 6, marginTop: 14 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Account name *</Text>
              <TextInput
                value={accountName}
                onChangeText={setAccountName}
                placeholder="As it appears on your bank account"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.foreground }}>Use as default for withdrawals</Text>
              <Switch value={makeDefault} onValueChange={setMakeDefault} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
            </View>

            {error && <Text style={{ fontSize: 13, color: colors.error, marginTop: 10 }}>{error}</Text>}

            <View style={{ marginTop: 18 }}>
              <Button title={saving ? "Saving…" : "Save bank account"} loading={saving} onPress={submit} />
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: "88%" },
});
