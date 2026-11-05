import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this device's Expo push token against the signed-in user, once per
 * app session. No UI — mount once near the app root (see app/_layout.tsx).
 *
 * Requires a development build, not Expo Go: remote push notifications via
 * expo-notifications have been unavailable in Expo Go on Android since SDK 53 (per
 * the versioned docs — see AGENTS.md's "Expo HAS CHANGED" note). Also requires
 * Device.isDevice — simulators/emulators can't obtain a real push token.
 */
export function PushNotificationRegistrar() {
  const { user, isAuthenticated } = useAuth();
  const registerMutation = trpc.notifications.registerPushToken.useMutation();

  useEffect(() => {
    if (!isAuthenticated || !user || Platform.OS === "web" || !Device.isDevice) return;

    let cancelled = false;

    (async () => {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== "granted" || cancelled) return;

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        console.warn("[push] no EAS projectId configured — cannot obtain an Expo push token.");
        return;
      }

      try {
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled || !token) return;
        registerMutation.mutate({ token, platform: Platform.OS === "ios" ? "ios" : "android" });
      } catch (err) {
        console.warn("[push] failed to obtain/register an Expo push token:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  return null;
}
