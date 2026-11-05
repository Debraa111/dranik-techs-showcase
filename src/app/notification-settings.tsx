import { ScrollView, Text, View, Switch, TouchableOpacity } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { Icon } from "@/components/icon-system";
import { Skeleton } from "@/components/ui/skeleton";
import { useColors } from "@/hooks/use-colors";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { trpc } from "@/lib/trpc";

interface NotificationSetting {
  key: string;
  icon: string;
  title: string;
  description: string;
}

const NOTIFICATION_TYPES: NotificationSetting[] = [
  {
    key: "bookingUpdates",
    icon: "bookings",
    title: "Booking Updates",
    description: "Confirmations, reminders, and status changes",
  },
  {
    key: "messages",
    icon: "chat",
    title: "Messages",
    description: "Messages from service providers",
  },
  {
    key: "promotions",
    icon: "money",
    title: "Promotions & Offers",
    description: "Discounts, deals, and special offers",
  },
  {
    key: "serviceReminders",
    icon: "clock",
    title: "Service Reminders",
    description: "Upcoming appointment reminders",
  },
];

/** Shown only to accounts with a provider profile — meaningless to a pure customer,
 *  who never receives this notification type in the first place. */
const PROVIDER_NOTIFICATION_TYPE: NotificationSetting = {
  key: "newBookingRequests",
  icon: "bookings",
  title: "New Booking Requests",
  description: "When a customer requests to book your service",
};

/**
 * Sound/vibration are device-only playback preferences with nothing to sync — unlike
 * the toggles above, there's no `notificationPreferences` column for these (and no
 * server-side notion of "device"), so they stay in AsyncStorage rather than round-
 * tripping to the backend.
 */
const DEVICE_PREFERENCES: NotificationSetting[] = [
  {
    key: "sound",
    icon: "notifications",
    title: "Sound",
    description: "Play sound for notifications",
  },
  {
    key: "vibration",
    icon: "notification",
    title: "Vibration",
    description: "Vibrate for notifications",
  },
];

const DEVICE_STORAGE_KEY = "notification_device_settings";

const DEFAULT_DEVICE_SETTINGS = { sound: true, vibration: true };

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [deviceSettings, setDeviceSettings] = useState(DEFAULT_DEVICE_SETTINGS);

  useEffect(() => {
    AsyncStorage.getItem(DEVICE_STORAGE_KEY).then((stored) => {
      if (!stored) return;
      try {
        setDeviceSettings({ ...DEFAULT_DEVICE_SETTINGS, ...JSON.parse(stored) });
      } catch {
        // keep defaults
      }
    });
  }, []);

  const providerProfileQuery = trpc.provider.myProfile.useQuery();
  const isProvider = !!providerProfileQuery.data;
  const prefsQuery = trpc.notifications.preferences.useQuery();
  const updateMutation = trpc.notifications.updatePreferences.useMutation({
    onMutate: async (partial) => {
      await utils.notifications.preferences.cancel();
      const previous = utils.notifications.preferences.getData();
      if (previous) utils.notifications.preferences.setData(undefined, { ...previous, ...partial });
      return { previous };
    },
    onError: (_err, _partial, context) => {
      if (context?.previous) utils.notifications.preferences.setData(undefined, context.previous);
    },
    onSettled: () => {
      utils.notifications.preferences.invalidate();
    },
  });

  const toggleServerSetting = (key: keyof NonNullable<typeof prefsQuery.data>) => {
    if (!prefsQuery.data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateMutation.mutate({ [key]: !prefsQuery.data[key] });
  };

  const toggleDeviceSetting = (key: keyof typeof DEFAULT_DEVICE_SETTINGS) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDeviceSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      AsyncStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pushEnabled = prefsQuery.data?.pushEnabled ?? true;

  const ServerSettingRow = ({ item }: { item: NotificationSetting }) => (
    <SettingRow
      item={item}
      colors={colors}
      value={!!prefsQuery.data?.[item.key as keyof NonNullable<typeof prefsQuery.data>]}
      disabled={!pushEnabled}
      onToggle={() => toggleServerSetting(item.key as keyof NonNullable<typeof prefsQuery.data>)}
    />
  );

  const DeviceSettingRow = ({ item }: { item: NotificationSetting }) => (
    <SettingRow
      item={item}
      colors={colors}
      value={deviceSettings[item.key as keyof typeof DEFAULT_DEVICE_SETTINGS]}
      disabled={!pushEnabled}
      onToggle={() => toggleDeviceSetting(item.key as keyof typeof DEFAULT_DEVICE_SETTINGS)}
    />
  );

  return (
    <ScreenContainer className="bg-background" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center gap-3 px-6 pt-4 pb-6">
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }}
          >
            <Icon name="back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View>
            <Text className="text-2xl font-bold" style={{ color: colors.foreground }}>
              Notification Settings
            </Text>
            <Text className="text-sm" style={{ color: colors.muted }}>
              Manage how you receive alerts
            </Text>
          </View>
        </View>

        {prefsQuery.isLoading ? (
          <View className="px-6" style={{ gap: 12 }}>
            <Skeleton width="100%" height={72} borderRadius={12} />
            <Skeleton width="100%" height={72} borderRadius={12} />
            <Skeleton width="100%" height={72} borderRadius={12} />
          </View>
        ) : (
          <>
            {/* Master Toggle */}
            <View className="px-6 pb-6">
              <View
                className="flex-row items-center justify-between py-4 px-4 rounded-xl"
                style={{ backgroundColor: colors.primary }}
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                  >
                    <Icon name="notifications" size={20} color="#ffffff" />
                  </View>
                  <View className="flex-1 pr-2">
                    <Text className="text-base font-bold text-white">Push Notifications</Text>
                    <Text className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                      Enable or disable all notifications
                    </Text>
                  </View>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={() => toggleServerSetting("pushEnabled")}
                  trackColor={{ false: "rgba(255,255,255,0.3)", true: "#1e40af" }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>

            {/* Notification Types */}
            <View className="px-6 pb-6">
              <Text className="text-lg font-bold mb-3" style={{ color: colors.foreground }}>
                Notification Types
              </Text>
              {NOTIFICATION_TYPES.map((item) => (
                <ServerSettingRow key={item.key} item={item} />
              ))}
              {isProvider && <ServerSettingRow item={PROVIDER_NOTIFICATION_TYPE} />}
            </View>

            {/* Preferences */}
            <View className="px-6 pb-8">
              <Text className="text-lg font-bold mb-3" style={{ color: colors.foreground }}>
                Preferences
              </Text>
              {DEVICE_PREFERENCES.map((item) => (
                <DeviceSettingRow key={item.key} item={item} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function SettingRow({
  item,
  colors,
  value,
  disabled,
  onToggle,
}: {
  item: NotificationSetting;
  colors: ReturnType<typeof useColors>;
  value: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <View
      className="flex-row items-center justify-between py-4 px-4 rounded-xl mb-2"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View className="flex-row items-center gap-3 flex-1">
        <View
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: colors.primary + "12" }}
        >
          <Icon name={item.icon} size={20} color={colors.primary} />
        </View>
        <View className="flex-1 pr-2">
          <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
            {item.title}
          </Text>
          <Text className="text-xs mt-1" style={{ color: colors.muted }}>
            {item.description}
          </Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
}
