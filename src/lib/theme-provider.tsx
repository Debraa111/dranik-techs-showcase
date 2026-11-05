import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColorScheme as useSystemColorScheme } from "@/hooks/use-color-scheme";
import type { ColorScheme } from "@/constants/theme";

export type ThemeMode = ColorScheme | "system";

const STORAGE_KEY = "theme_mode";

type ThemeModeContextValue = {
  mode: ThemeMode;
  resolvedScheme: ColorScheme;
  setMode: (mode: ThemeMode) => void;
  isLoaded: boolean;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() ?? "light";
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      }
      setIsLoaded(true);
    });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const resolvedScheme: ColorScheme = mode === "system" ? systemScheme : mode;

  const value = useMemo(
    () => ({ mode, resolvedScheme, setMode, isLoaded }),
    [mode, resolvedScheme, setMode, isLoaded],
  );

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used within ThemeModeProvider");
  }
  return ctx;
}
