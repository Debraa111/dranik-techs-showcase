import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useColors } from "@/hooks/use-colors";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: object;
}

/** Pulsing loading placeholder for content that is still fetching. */
export function Skeleton({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const colors = useColors();
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.9, { duration: 700 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: colors.border },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Ready-made skeleton for a service card while lists load. */
export function ServiceCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton height={140} borderRadius={12} />
      <View style={styles.body}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="45%" height={12} />
        <Skeleton width="30%" height={14} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    marginBottom: 16,
  },
  body: {
    gap: 8,
  },
});
