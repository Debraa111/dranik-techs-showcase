import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useThemeMode, type ThemeMode } from "@/lib/theme-provider";
import { getBiometricLockEnabled, setBiometricLockEnabled } from "@/lib/local-store";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type ColorPalette = ReturnType<typeof useColors>;

const APPEARANCE_OPTIONS: { mode: ThemeMode; icon: keyof typeof MaterialIcons.glyphMap; title: string; description: string }[] = [
  { mode: "light", icon: "light-mode", title: "Light", description: "Always use light appearance" },
  { mode: "dark", icon: "dark-mode", title: "Dark", description: "Always use dark appearance" },
  { mode: "system", icon: "brightness-auto", title: "System", description: "Match your phone's appearance setting" },
];

function SectionLabel({ title, colors }: { title: string; colors: ColorPalette }) {
  return (
    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 3 }}>{title}</Text>
  );
}

function MenuRow({
  icon,
  label,
  colors,
  danger,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  colors: ColorPalette;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: danger ? `${colors.error}12` : `${colors.primary}12`,
        }}
      >
        <MaterialIcons name={icon} size={19} color={danger ? colors.error : colors.primary} />
      </View>
      <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "600", color: danger ? colors.error : colors.foreground }}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  const { logout } = useAuth();
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation();

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [checkingBiometric, setCheckingBiometric] = useState(true);

  useEffect(() => {
    (async () => {
      const [hasHardware, isEnrolled, enabled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        getBiometricLockEnabled(),
      ]);
      setBiometricSupported(hasHardware && isEnrolled);
      setBiometricEnabledState(enabled);
      setCheckingBiometric(false);
    })();
  }, []);

  const toggleBiometric = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !biometricEnabled;
    setBiometricEnabledState(next);
    await setBiometricLockEnabled(next);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your D'RANIK account data. This can't be undone. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccountMutation.mutateAsync();
              await logout();
              router.replace("/welcome" as any);
            } catch (e: any) {
              Alert.alert("Could not delete account", e?.message ?? "Please try again.");
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Settings</Text>
        </View>

        {/* Appearance */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 24 }}>
          <SectionLabel title="Appearance" colors={colors} />
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
            Choose how D'RANIK Techs looks on this device.
          </Text>

          <View style={{ gap: 10 }}>
            {APPEARANCE_OPTIONS.map((option) => {
              const active = mode === option.mode;
              return (
                <TouchableOpacity
                  key={option.mode}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setMode(option.mode);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    backgroundColor: colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    borderWidth: active ? 1.5 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${colors.primary}12`,
                    }}
                  >
                    <MaterialIcons name={option.icon} size={19} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.foreground }}>{option.title}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{option.description}</Text>
                  </View>
                  {active ? (
                    <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Security */}
        {!checkingBiometric && biometricSupported && (
          <View style={{ paddingHorizontal: 24, paddingBottom: 24 }}>
            <SectionLabel title="Security" colors={colors} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 14,
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.primary}12` }}>
                <MaterialIcons name="fingerprint" size={19} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.foreground }}>App lock</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>Require Face ID / fingerprint to open the app</Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
              />
            </View>
          </View>
        )}

        {/* Preferences */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 10 }}>
          <SectionLabel title="Preferences" colors={colors} />
          <MenuRow
            icon="notifications-none"
            label="Notification Settings"
            colors={colors}
            onPress={() => router.push("/notification-settings" as any)}
          />
        </View>

        {/* Support */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 10 }}>
          <SectionLabel title="Support" colors={colors} />
          <MenuRow icon="support-agent" label="Contact Support" colors={colors} onPress={() => router.push("/support" as any)} />
        </View>

        {/* About */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 10 }}>
          <SectionLabel title="About" colors={colors} />
          <MenuRow icon="info-outline" label="About D'RANIK Techs" colors={colors} onPress={() => router.push("/about" as any)} />
          <MenuRow icon="description" label="Terms of Service" colors={colors} onPress={() => router.push("/terms" as any)} />
          <MenuRow icon="privacy-tip" label="Privacy Policy" colors={colors} onPress={() => router.push("/privacy-policy" as any)} />
        </View>

        {/* Account */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 8, gap: 10 }}>
          <SectionLabel title="Account" colors={colors} />
          <MenuRow icon="delete-outline" label="Delete account" colors={colors} danger onPress={handleDeleteAccount} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
