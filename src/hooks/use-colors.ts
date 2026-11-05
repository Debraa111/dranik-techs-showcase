import { Colors } from "@/constants/theme";
import { useThemeMode } from "@/lib/theme-provider";

/** Returns the active color palette (light or dark), honoring the user's manual theme override. */
export function useColors() {
  const { resolvedScheme } = useThemeMode();
  return Colors[resolvedScheme];
}
