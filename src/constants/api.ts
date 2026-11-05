import { Platform } from "react-native";
import Constants from "expo-constants";

/** Base URL of the API/tRPC server. */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv) return fromEnv;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  // Local dev fallback: Metro's dev server host, port 3000 (the Express API).
  const debuggerHost = Constants.expoConfig?.hostUri?.split(":")[0];
  return debuggerHost ? `http://${debuggerHost}:3000` : "http://localhost:3000";
}
