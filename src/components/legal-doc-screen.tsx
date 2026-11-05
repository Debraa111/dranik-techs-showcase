import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export interface LegalSection {
  heading: string;
  body: string;
}

/** Shared scroll/header chrome for Terms of Service and Privacy Policy. */
export function LegalDocScreen({
  title,
  lastUpdated,
  intro,
  sections,
}: {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
}) {
  const colors = useColors();
  const router = useRouter();

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
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
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>{title}</Text>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 16, gap: 18 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>Last updated: {lastUpdated}</Text>
          <Text style={{ fontSize: 14, lineHeight: 21, color: colors.foreground }}>{intro}</Text>

          {sections.map((section) => (
            <View key={section.heading} style={{ gap: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{section.heading}</Text>
              <Text style={{ fontSize: 13.5, lineHeight: 20.5, color: colors.foreground, opacity: 0.85 }}>{section.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
