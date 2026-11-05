import { View, TouchableOpacity } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ComponentProps } from "react";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

/**
 * Professional icon system using Material Design vector icons.
 * Maps semantic app icon names to MaterialIcons glyphs.
 */
const ICON_MAP: Record<string, MaterialIconName> = {
  // Navigation
  "home": "home",
  "search": "search",
  "bookings": "event-note",
  "notifications": "notifications",
  "profile": "person",

  // Categories
  "home-services": "home-repair-service",
  "beauty": "spa",
  "events": "celebration",
  "healthcare": "medical-services",
  "fitness": "fitness-center",
  "education": "school",
  "technology": "computer",
  "food": "restaurant",
  "plumbing": "plumbing",
  "cleaning": "cleaning-services",
  "electrical": "electrical-services",
  "gardening": "yard",

  // Actions
  "star": "star",
  "star-filled": "star",
  "star-empty": "star-border",
  "verified": "check",
  "location": "location-on",
  "location-pin": "place",
  "clock": "schedule",
  "phone": "phone",
  "message": "chat-bubble-outline",
  "share": "share",
  "bookmark": "bookmark-border",
  "heart": "favorite-border",
  "check": "check",
  "close": "close",
  "menu": "menu",
  "settings": "settings",
  "logout": "logout",
  "edit": "edit",
  "delete": "delete",
  "add": "add",
  "back": "arrow-back",
  "forward": "arrow-forward",
  "arrow-right": "arrow-forward",
  "arrow-down": "keyboard-arrow-down",
  "down": "keyboard-arrow-down",
  "up": "keyboard-arrow-up",
  "chevron-right": "chevron-right",

  // Status
  "success": "check-circle",
  "error": "error",
  "warning": "warning",
  "info": "info",
  "loading": "hourglass-empty",

  // Payment & Booking
  "payment": "credit-card",
  "wallet": "account-balance-wallet",
  "money": "payments",
  "calendar": "calendar-today",
  "time": "access-time",

  // Communication
  "email": "email",
  "call": "call",
  "chat": "chat",
  "notification": "notifications",

  // Theme
  "moon": "dark-mode",
  "sun": "light-mode",
};

export function Icon({ name, size = 24, color = "#2563EB" }: IconProps) {
  const iconName = ICON_MAP[name] || "help-outline";
  return <MaterialIcons name={iconName} size={size} color={color} />;
}

/**
 * Icon button component for consistent icon interactions
 */
export function IconButton({
  name,
  onPress,
  size = 24,
  color = "#2563EB",
  backgroundColor = "transparent",
}: IconProps & {
  onPress?: () => void;
  backgroundColor?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: size + 16,
        height: size + 16,
        borderRadius: (size + 16) / 2,
        backgroundColor,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Icon name={name} size={size} color={color} />
    </TouchableOpacity>
  );
}
