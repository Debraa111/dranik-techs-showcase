import { useState } from "react";
import { Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/use-colors";
import { useThemeMode } from "@/lib/theme-provider";
import { MIN_DOB, MAX_DOB, formatISODate, parseISODate, formatDisplay, dobFieldStyles } from "@/lib/date-of-birth-utils";

interface DateOfBirthPickerProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Native date-of-birth picker via @react-native-community/datetimepicker — bundled into
 * Expo Go's prebuilt binary (unlike @expo/ui, which needs a custom dev client before
 * SDK 56; this project is pinned to SDK 54), so it works with plain `expo start`.
 * iOS renders the wheel picker inline inside a tap-to-open bottom sheet; Android uses the
 * library's imperative DateTimePickerAndroid.open() (its own docs recommend this over the
 * declarative component on Android, which mirrors a native dialog). Both are safe to
 * import unconditionally here — the library's own web/unsupported-platform fallback is a
 * no-op stub, not a native-module crash, so web keeps a plain text field without needing
 * a separate platform file.
 */
export function DateOfBirthPicker({ value, onChange }: DateOfBirthPickerProps) {
  const colors = useColors();
  const { resolvedScheme } = useThemeMode();
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value) ?? MAX_DOB;

  const fieldStyle = [dobFieldStyles.input, { backgroundColor: colors.surface, borderColor: colors.border }];

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value: selected,
      mode: "date",
      display: "calendar",
      minimumDate: MIN_DOB,
      maximumDate: MAX_DOB,
      onChange: (_event, date) => {
        if (date) onChange(formatISODate(date));
      },
    });
  };

  if (Platform.OS === "android") {
    return (
      <TouchableOpacity
        onPress={openAndroidPicker}
        style={[fieldStyle, dobFieldStyles.row]}
        accessibilityRole="button"
        accessibilityLabel="Choose your date of birth"
      >
        <Text style={{ color: value ? colors.foreground : colors.muted, fontSize: 15 }}>
          {value ? formatDisplay(value) : "Select your date of birth"}
        </Text>
        <MaterialIcons name="event" size={18} color={colors.muted} />
      </TouchableOpacity>
    );
  }

  if (Platform.OS === "ios") {
    return (
      <>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          style={[fieldStyle, dobFieldStyles.row]}
          accessibilityRole="button"
          accessibilityLabel="Choose your date of birth"
        >
          <Text style={{ color: value ? colors.foreground : colors.muted, fontSize: 15 }}>
            {value ? formatDisplay(value) : "Select your date of birth"}
          </Text>
          <MaterialIcons name="event" size={18} color={colors.muted} />
        </TouchableOpacity>

        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.overlay}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setOpen(false)} />
            <View style={[styles.sheet, { backgroundColor: colors.background }]}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
              <View style={styles.sheetHeader}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Date of birth</Text>
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={selected}
                mode="date"
                display="spinner"
                themeVariant={resolvedScheme}
                minimumDate={MIN_DOB}
                maximumDate={MAX_DOB}
                onChange={(_event, date) => {
                  if (date) onChange(formatISODate(date));
                }}
              />
            </View>
          </View>
        </Modal>
      </>
    );
  }

  // Web: this library has no web implementation (its own fallback is a safe no-op, not a
  // crash, but still renders nothing) — keep manual entry.
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="e.g. 1990-04-15"
      placeholderTextColor={colors.muted}
      keyboardType="numbers-and-punctuation"
      style={[fieldStyle, { color: colors.foreground, fontSize: 15 }]}
      returnKeyType="done"
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
});
