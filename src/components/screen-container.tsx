import type { ReactNode } from "react";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";

interface ScreenContainerProps {
  children: ReactNode;
  className?: string;
  edges?: readonly Edge[];
}

/** SafeArea wrapper used as the outermost element of every screen. */
export function ScreenContainer({ children, className, edges }: ScreenContainerProps) {
  const colors = useColors();

  return (
    <SafeAreaView
      className={className}
      edges={edges}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {children}
    </SafeAreaView>
  );
}
