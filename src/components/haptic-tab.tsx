import { Platform } from "react-native";
import { PlatformPressable } from "@react-navigation/elements";
import * as Haptics from "expo-haptics";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";

/** Tab bar button that adds a light haptic tap on iOS/Android. */
export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
