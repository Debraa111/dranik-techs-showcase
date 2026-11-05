import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set — auth will not work. " +
      "Get these from the Supabase dashboard: Project Settings -> API.",
  );
}

// createClient() validates its URL eagerly and throws if empty — fall back to
// a placeholder so a missing env var fails at actual auth-call time (with a
// clear Supabase error) instead of crashing the whole bundle/build.
const url = supabaseUrl || "https://placeholder.supabase.co";
const anonKey = supabaseAnonKey || "placeholder-anon-key";

/**
 * Shared Supabase client. Handles sign-up/sign-in/session-refresh directly
 * against Supabase's hosted Auth API — no calls to our own server needed for
 * any of that. Our server only ever verifies the resulting access token
 * (see server/_core/sdk.ts).
 *
 * Uses AsyncStorage (not SecureStore) for session persistence on native:
 * SecureStore's ~2KB item limit is too small for a full Supabase session
 * payload (access token + refresh token + user object).
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});
