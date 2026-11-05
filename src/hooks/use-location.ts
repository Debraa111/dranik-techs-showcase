import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";

type Coords = { latitude: number; longitude: number };
type Status = "idle" | "loading" | "granted" | "denied" | "error";

/**
 * Foreground device location, used for "distance away" on providers/services.
 * Never prompts on mount — only checks whether permission was already granted
 * and fetches silently in that case. Call `request()` to trigger the actual
 * system permission prompt (e.g. from a "Sort by distance" tap).
 */
export function useLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const fetchPosition = useCallback(async () => {
    setStatus("loading");
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setStatus("granted");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status: existing }) => {
      if (existing === "granted") fetchPosition();
    });
  }, [fetchPosition]);

  const request = useCallback(async () => {
    setStatus("loading");
    const { status: result } = await Location.requestForegroundPermissionsAsync();
    if (result === "granted") {
      await fetchPosition();
    } else {
      setStatus("denied");
    }
  }, [fetchPosition]);

  return { coords, status, request };
}
