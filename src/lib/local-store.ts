import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small typed wrappers around AsyncStorage for device-local state:
 * favorites (service ids) and search history.
 */

const FAVORITES_KEY = "dranik.favorites.v1";
const SEARCH_HISTORY_KEY = "dranik.searchHistory.v1";
const RECENTLY_VIEWED_KEY = "dranik.recentlyViewed.v1";
const BIOMETRIC_LOCK_KEY = "dranik.biometricLock.v1";
const MAX_HISTORY = 10;
const MAX_RECENT = 10;

export async function getFavorites(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export async function toggleFavorite(serviceId: number): Promise<number[]> {
  const current = await getFavorites();
  const next = current.includes(serviceId)
    ? current.filter((id) => id !== serviceId)
    : [...current, serviceId];
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  return next;
}

export async function getSearchHistory(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function addSearchHistory(term: string): Promise<string[]> {
  const clean = term.trim();
  if (!clean) return getSearchHistory();
  const current = await getSearchHistory();
  const next = [clean, ...current.filter((t) => t.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearSearchHistory(): Promise<void> {
  await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
}

/* ----------------------------- Recently viewed ---------------------------- */

export async function getRecentlyViewed(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export async function addRecentlyViewed(serviceId: number): Promise<number[]> {
  const current = await getRecentlyViewed();
  const next = [serviceId, ...current.filter((id) => id !== serviceId)].slice(0, MAX_RECENT);
  await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  return next;
}

/* ----------------------------- Biometric lock ----------------------------- */

export async function getBiometricLockEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BIOMETRIC_LOCK_KEY);
    return raw === "true";
  } catch {
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_LOCK_KEY, enabled ? "true" : "false");
}
