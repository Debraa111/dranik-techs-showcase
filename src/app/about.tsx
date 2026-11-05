import { Image, Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const WEBSITE_URL = "https://www.draniktechs.com";

/** Pulled from app.config.ts's `version` field at runtime — never hardcode this. */
const APP_VERSION = Constants.expoConfig?.version ?? "—";

export default function AboutScreen() {
  const colors = useColors();
  const router = useRouter();

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
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
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>About</Text>
        </View>

        <View style={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 28 }}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 14 }}
          />
          <Text style={{ fontSize: 19, fontWeight: "800", color: colors.foreground }}>D'RANIK Techs</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>Version {APP_VERSION}</Text>
        </View>

        <View style={{ paddingHorizontal: 24, gap: 16 }}>
          <Text style={{ fontSize: 14, lineHeight: 21, color: colors.foreground }}>
            D'RANIK Techs connects you with trusted, verified service professionals — electricians, plumbers,
            cleaners, beauticians, and more — for home services, beauty, healthcare, and events. Book instantly,
            negotiate a price, track your job in real time, and pay securely, all in one app.
          </Text>

          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Linking.openURL(WEBSITE_URL);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 14,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.primary}12` }}>
              <MaterialIcons name="language" size={19} color={colors.primary} />
            </View>
            <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.foreground }}>Visit our website</Text>
            <MaterialIcons name="open-in-new" size={18} color={colors.muted} />
          </TouchableOpacity>

          <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 8 }}>
            © {new Date().getFullYear()} D'RANIK Techs. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
