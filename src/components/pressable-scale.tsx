import { useState } from "react";
import { Pressable } from "react-native";

export function PressableScale({
  onPress,
  style,
  children,
}: {
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      android_ripple={{ color: "rgba(0,0,0,0.06)" }}
      style={[style, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}
