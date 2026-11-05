import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";

type ColorPalette = ReturnType<typeof useColors>;

/** Add/remove chip editor for simple string-array fields (skills, languages, tags, materials, service areas). */
export function TagInput({
  values,
  onChange,
  placeholder,
  maxItems = 30,
  colors,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  colors: ColorPalette;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || values.length >= maxItems || values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  };

  const remove = (value: string) => onChange(values.filter((v) => v !== value));

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
        />
        <TouchableOpacity
          onPress={add}
          disabled={!draft.trim()}
          style={[styles.addBtn, { backgroundColor: draft.trim() ? colors.primary : colors.border }]}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      {values.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {values.map((v) => (
            <View key={v} style={[styles.chip, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}>
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.foreground }}>{v}</Text>
              <TouchableOpacity onPress={() => remove(v)} hitSlop={6}>
                <MaterialIcons name="close" size={14} color={colors.muted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
