import "@/global.css";

import { useEffect, useState } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import { AppLockGate } from "@/components/app-lock-gate";
import { PushNotificationRegistrar } from "@/components/push-notification-registrar";
import { trpc, createTRPCClient } from "@/lib/trpc";
import { ThemeModeProvider, useThemeMode } from "@/lib/theme-provider";

SplashScreen.preventAutoHideAsync();

function NavigationRoot() {
  const { resolvedScheme, isLoaded } = useThemeMode();
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => createTRPCClient());

  useEffect(() => {
    if (isLoaded) SplashScreen.hideAsync();
  }, [isLoaded]);

  if (!isLoaded) return null;

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={resolvedScheme === "dark" ? DarkTheme : DefaultTheme}>
          <PushNotificationRegistrar />
          <AppLockGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="welcome" options={{ presentation: "fullScreenModal" }} />
            </Stack>
          </AppLockGate>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <NavigationRoot />
    </ThemeModeProvider>
  );
}
