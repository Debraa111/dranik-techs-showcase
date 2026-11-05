import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const SUPPORT_EMAIL = "support@example.com";

const CATEGORIES: { id: "booking" | "payment" | "account" | "provider" | "other"; label: string }[] = [
  { id: "booking", label: "Booking" },
  { id: "payment", label: "Payment" },
  { id: "account", label: "Account" },
  { id: "provider", label: "Provider" },
  { id: "other", label: "Other" },
];

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function SupportScreen() {
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("other");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const ticketsQuery = trpc.support.myTickets.useQuery();
  const createTicketMutation = trpc.support.createTicket.useMutation({
    onSuccess: () => {
      utils.support.myTickets.invalidate();
      setSubject("");
      setDescription("");
      setCategory("other");
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    },
  });

  const submit = async () => {
    setError(null);
    if (subject.trim().length < 3) {
      setError("Give your issue a short subject (at least 3 characters).");
      return;
    }
    if (description.trim().length < 10) {
      setError("Add a bit more detail so support can help (at least 10 characters).");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await createTicketMutation.mutateAsync({ subject: subject.trim(), description: description.trim(), category });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't submit your request. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const tickets = ticketsQuery.data ?? [];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            }}
          >
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Support</Text>
        </View>

        <View style={{ paddingHorizontal: 24, gap: 20 }}>
          {/* Contact form */}
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Contact support</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: -8 }}>
              Send us a message and we'll get back to you. You can track its status below.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setCategory(c.id);
                    }}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 20,
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                      borderWidth: 1,
                    }}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: active ? "#fff" : colors.foreground }}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={colors.muted}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: colors.foreground,
              }}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your issue..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: colors.foreground,
                minHeight: 100,
                textAlignVertical: "top",
              }}
            />
            {error && <Text style={{ fontSize: 12.5, color: colors.error }}>{error}</Text>}
            {submitted && (
              <Text style={{ fontSize: 12.5, color: colors.success, fontWeight: "600" }}>
                Request sent — we'll get back to you soon.
              </Text>
            )}
            <Button title="Send request" loading={createTicketMutation.isPending} onPress={submit} />

            <TouchableOpacity
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6 }}
            >
              <MaterialIcons name="email" size={15} color={colors.muted} />
              <Text style={{ fontSize: 12.5, color: colors.muted }}>Or email us at {SUPPORT_EMAIL}</Text>
            </TouchableOpacity>
          </View>

          {/* My tickets */}
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>My requests</Text>
            {ticketsQuery.isLoading ? (
              <View style={{ gap: 10 }}>
                <Skeleton width="100%" height={64} borderRadius={12} />
                <Skeleton width="100%" height={64} borderRadius={12} />
              </View>
            ) : tickets.length === 0 ? (
              <EmptyState icon="support-agent" title="No requests yet" description="Anything you send support will show up here." />
            ) : (
              <View style={{ gap: 10 }}>
                {tickets.map((t: any) => (
                  <View
                    key={t.id}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderWidth: 1,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={1}>
                        {t.subject}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 8,
                          backgroundColor: t.status === "resolved" || t.status === "closed" ? `${colors.success}18` : `${colors.primary}18`,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10.5,
                            fontWeight: "700",
                            color: t.status === "resolved" || t.status === "closed" ? colors.success : colors.primary,
                          }}
                        >
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={2}>
                      {t.description}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{timeAgo(t.createdAt)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
