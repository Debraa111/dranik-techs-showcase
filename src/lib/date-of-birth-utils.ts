import { StyleSheet } from "react-native";

export const dobFieldStyles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

const now = new Date();
/** A provider must be at least 18. */
export const MAX_DOB = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
/** Reasonable upper bound on age. */
export const MIN_DOB = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDisplay(value: string): string {
  const date = parseISODate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

/** True if `value` (YYYY-MM-DD) is a real date falling within the 18-100 year old window. */
export function isAdultBirthDate(value: string): boolean {
  const date = parseISODate(value);
  if (!date) return false;
  return date.getTime() <= MAX_DOB.getTime() && date.getTime() >= MIN_DOB.getTime();
}
