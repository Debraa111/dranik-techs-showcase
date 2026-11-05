import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { supabase } from "@/lib/supabase";

const FEATURES = [
  { icon: "verified-user" as const, title: "Verified professionals", body: "Every provider is vetted and background-checked." },
  { icon: "bolt" as const, title: "Book in minutes", body: "Pick a service, choose a time, and you're done." },
  { icon: "lock" as const, title: "Secure payments", body: "Pay safely with cards, transfer, or wallet." },
];

type Mode = "signup" | "login";

/** Welcome / sign-in screen. Shown when the user is not authenticated. */
export default function WelcomeScreen() {
  const colors = useColors();
  const { isAuthenticated, loading } = useAuth();

  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace("/(tabs)" as any);
    }
  }, [isAuthenticated, loading]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setResendError(null);
    setResendSent(false);
    try {
      const { error: resendErr } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (resendErr) {
        setResendError(resendErr.message);
      } else {
        setResendSent(true);
        setResendCooldown(60);
      }
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Could not resend. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const canSubmit =
    email.trim().length > 3 &&
    email.includes("@") &&
    password.length >= 6 &&
    (mode === "login" || name.trim().length >= 2) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    console.log(`[welcome] ${mode} submit for`, email.trim());
    setSubmitting(true);
    setError(null);
    setCheckEmail(false);

    try {
      const { data, error: authError } =
        mode === "signup"
          ? await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: { data: { name: name.trim() } },
            })
          : await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (authError) {
        console.log(`[welcome] ${mode} error:`, authError.message);
        if (mode === "signup" && /already registered|already exists/i.test(authError.message)) {
          setError("An account with this email already exists. Try logging in instead.");
        } else if (
          mode === "login" &&
          ((authError as any).code === "email_not_confirmed" || /email not confirmed/i.test(authError.message))
        ) {
          // Same wording/UI as a fresh signup's pending-confirmation state — this
          // person already has an account, they just never clicked the link yet.
          setCheckEmail(true);
        } else {
          setError(authError.message);
        }
        return;
      }

      if (mode === "signup" && !data.session) {
        // Email confirmation is required by the Supabase project's Auth settings.
        setCheckEmail(true);
        return;
      }
      console.log(`[welcome] ${mode} succeeded, session present:`, !!data.session);
      // On success, useAuth's onAuthStateChange picks up the new session and the
      // redirect effect above sends us to the tabs.
    } catch (err) {
      // supabase-js normally reports auth failures via `error` above, not by
      // throwing — a caught exception here means something more fundamental
      // went wrong (e.g. can't reach Supabase at all). Surface it instead of
      // letting it disappear as an unhandled rejection.
      console.error(`[welcome] ${mode} threw:`, err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer className="px-6" edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)} style={styles.hero}>
          <View style={[styles.logoWrap, { backgroundColor: `${colors.primary}0D` }]}>
            <Image
              source={require("@/assets/images/dranik-logo.jpeg")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>D&apos;RANIK Techs</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Find trusted professionals near you — cleaning, beauty, repairs, tech and more.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(150).duration(400)} style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: `${colors.primary}12` }]}>
                <MaterialIcons name={f.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                <Text style={[styles.featureBody, { color: colors.muted }]}>{f.body}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

        {/* Plain View, not Animated.View: Reanimated's `entering` animation on a
            container wrapping TextInputs is a known cause of the field silently
            not receiving touch/focus on some devices. */}
        <View style={styles.actions}>
          {checkEmail ? (
            <View style={styles.checkEmailBox}>
              <MaterialIcons name="mark-email-read" size={28} color={colors.primary} />
              <View style={[styles.verifyBadge, { backgroundColor: `${colors.warning}18` }]}>
                <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.warning }}>
                  Please verify your email to continue
                </Text>
              </View>
              <Text style={[styles.hint, { color: colors.foreground, fontWeight: "700" }]}>
                Check your email
              </Text>
              <Text style={[styles.hint, { color: colors.muted }]}>
                We sent a confirmation link to {email.trim()}. You won&apos;t be able to sign in until you confirm it.
              </Text>
              {resendSent && (
                <Text style={[styles.hint, { color: colors.success, fontWeight: "600" }]}>
                  Email resent — check your inbox (and spam folder).
                </Text>
              )}
              {resendError && <Text style={[styles.hint, { color: colors.error }]}>{resendError}</Text>}
              <Button
                title={resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : "Resend verification email"}
                variant="tinted"
                loading={resending}
                disabled={resendCooldown > 0}
                onPress={handleResend}
              />
              <Button title="Back to log in" variant="ghost" onPress={() => { setCheckEmail(false); setMode("login"); }} />
            </View>
          ) : (
            <>
              {mode === "signup" && (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  textContentType="name"
                  autoComplete="name"
                  importantForAutofill="yes"
                  style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
                />
              )}
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                importantForAutofill="yes"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password (min. 6 characters)"
                placeholderTextColor={colors.muted}
                secureTextEntry
                textContentType={mode === "signup" ? "newPassword" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "password"}
                importantForAutofill="yes"
                style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              />

              {error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}

              <Button
                title={mode === "signup" ? "Create account" : "Log in"}
                size="lg"
                fullWidth
                loading={submitting}
                disabled={!canSubmit}
                onPress={handleSubmit}
                icon={<MaterialIcons name="login" size={20} color="#FFFFFF" />}
              />

              <TouchableOpacity onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }}>
                <Text style={[styles.hint, { color: colors.primary, fontWeight: "600" }]}>
                  {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "space-between", paddingVertical: 24 },
  hero: { alignItems: "center", gap: 12, marginTop: 24 },
  logoWrap: {
    width: 104,
    height: 104,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  logo: { width: 72, height: 72 },
  title: { fontSize: 30, fontWeight: "800", lineHeight: 38 },
  subtitle: { fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: 12 },
  features: { gap: 18 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, gap: 2 },
  featureTitle: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  featureBody: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 12, marginBottom: 8 },
  hint: { fontSize: 12, textAlign: "center", lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  error: { fontSize: 13, textAlign: "center" },
  checkEmailBox: { alignItems: "center", gap: 8, paddingVertical: 12, width: "100%" },
  verifyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
});
