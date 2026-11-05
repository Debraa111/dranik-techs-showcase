import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

/**
 * Auth state, backed by Supabase Auth for the session and our own
 * `auth.me` tRPC query for the app-side user row (role, appRole, etc).
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: !!session });

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    user: meQuery.data ?? null,
    loading: sessionLoading || (!!session && meQuery.isLoading),
    error: meQuery.error ?? null,
    isAuthenticated: !!session && !!meQuery.data,
    refresh: meQuery.refetch,
    logout,
  };
}
