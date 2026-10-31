import type { Field } from "../types/field";

export type CollectionGrouping = Readonly<{
  field: string;
  options: readonly Readonly<{ value: string; label: string }>[];
}>;

export type CollectionSection<T> = Readonly<{
  key: string;
  label: string;
  rows: readonly T[];
}>;

export function resolveCollectionGrouping(
  fieldPath: string | undefined,
  field: Field | undefined,
): CollectionGrouping | undefined {
  if (!fieldPath) return undefined;
  const values = field?.options?.values;
  return {
    field: fieldPath,
    options: Array.isArray(values) ? values.map(option => {
      if (typeof option === "object" && option !== null) {
        const value = option.value ?? option.name;
        return { value: String(value ?? ""), label: String(option.label ?? value ?? "") };
      }
      return { value: String(option), label: String(option) };
    }) : [],
  };
}

export function collectionSections<T>(
  rows: readonly T[],
  grouping: CollectionGrouping,
  valueAt: (row: T, field: string) => unknown,
): readonly CollectionSection<T>[] {
  const sections = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const value = valueAt(row, grouping.field);
    const missing = value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));
    const key = missing ? "empty" : `${typeof value}:${String(value)}`;
    let section = sections.get(key);
    if (!section) {
      const label = missing ? "(empty)" : grouping.options.find(option => option.value === String(value))?.label ?? String(value);
      section = { key, label, rows: [] };
      sections.set(key, section);
    }
    section.rows.push(row);
  }
  const empty = sections.get("empty");
  if (empty) {
    sections.delete("empty");
    sections.set("empty", empty);
  }
  return [...sections.values()];
}
