import { useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { getBiometricLockEnabled } from "@/lib/local-store";

/**
 * Biometric app lock: when the user enables app lock in Privacy & Security,
 * this gate requires Face ID / fingerprint on cold start and when returning
 * from the background. No-op on web and when the lock is disabled.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(Platform.OS !== "web");

  const tryUnlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock D'RANIK Techs",
    });
    if (result.success) setLocked(false);
  };

  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;

    (async () => {
      const enabled = await getBiometricLockEnabled();
      if (!mounted) return;
      if (enabled) {
        setLocked(true);
        setChecking(false);
        tryUnlock();
      } else {
        setChecking(false);
      }
    })();

    // Re-lock when app returns from background
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active") return;
      const enabled = await getBiometricLockEnabled();
      if (enabled) setLocked(true);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (checking) return null;

  if (locked) {
    return (
      <View style={[styles.lockScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.lockIcon, { backgroundColor: `${colors.primary}12` }]}>
          <MaterialIcons name="lock" size={40} color={colors.primary} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>App locked</Text>
        <Text style={{ fontSize: 13.5, color: colors.muted, textAlign: "center", paddingHorizontal: 40 }}>
          Use Face ID or your fingerprint to unlock D'RANIK Techs.
        </Text>
        <TouchableOpacity onPress={tryUnlock} style={[styles.unlockBtn, { backgroundColor: colors.primary }]}>
          <MaterialIcons name="fingerprint" size={20} color="#fff" />
          <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  lockScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  lockIcon: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 10,
  },
});
