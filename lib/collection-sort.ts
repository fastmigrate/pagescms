import { z } from "zod";

const fieldPath = z.string().min(1).refine(
  (path) => path.split('.').every(part => part && !['__proto__', 'prototype', 'constructor'].includes(part)),
  'Use a valid field path.',
);
export const SortPresetSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1),
  fields: z.array(z.object({
    field: fieldPath,
    order: z.enum(['asc', 'desc']),
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).optional(),
  }).strict()).min(1),
}).strict().superRefine((preset, ctx) => {
  const fields = new Set<string>();
  preset.fields.forEach((rule, index) => {
    if (fields.has(rule.field)) ctx.addIssue({ code: 'custom', message: 'Sort fields must be unique.', path: ['fields', index, 'field'] });
    fields.add(rule.field);
    if (rule.values && new Set(rule.values).size !== rule.values.length) ctx.addIssue({ code: 'custom', message: 'Ordered values must be unique.', path: ['fields', index, 'values'] });
  });
});
export type SortPreset = z.infer<typeof SortPresetSchema>;
type SortEntry = { fields?: Record<string, unknown>; path: string; type?: string };

export const presetColumnId = (name: string) => `__sortPreset:${name}`;
export const presetFieldPaths = (presets: SortPreset[] = []) =>
  [...new Set(presets.flatMap(preset => preset.fields.map(rule => rule.field)))];

export const presetRequestFields = (presets: SortPreset[] = []) =>
  presetFieldPaths(presets).map(path => `fields.${path}`);

function valueAt(fields: SortEntry['fields'], path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' && Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key] : undefined, fields);
}
function scalarCompare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}
const missing = (value: unknown) => value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));

/** Pure comparison over loaded fields; no stored/computed content is written. */
export function comparePresetEntries(a: SortEntry, b: SortEntry, preset: SortPreset, foldersFirst = false): number {
  if ((a.type === 'dir') !== (b.type === 'dir')) return (a.type === 'dir') === foldersFirst ? -1 : 1;
  for (const rule of preset.fields) {
    const av = valueAt(a.fields, rule.field), bv = valueAt(b.fields, rule.field);
    // Incomplete entries always follow populated values, independent of direction.
    if (missing(av) !== missing(bv)) return missing(av) ? 1 : -1;
    if (missing(av)) continue;
    let compared = 0;
    if (rule.values) {
      const ai = rule.values.indexOf(av as string | number | boolean);
      const bi = rule.values.indexOf(bv as string | number | boolean);
      if ((ai < 0) !== (bi < 0)) return ai < 0 ? 1 : -1;
      compared = ai >= 0 && bi >= 0 ? ai - bi : scalarCompare(av, bv);
    } else compared = scalarCompare(av, bv);
    if (compared) return rule.order === 'desc' ? -compared : compared;
  }
  return a.path.localeCompare(b.path);
}

export function presetColumns(presets: SortPreset[] = [], foldersFirst = false) {
  return presets.map(preset => ({
    id: presetColumnId(preset.name),
    accessorFn: () => true,
    enableGlobalFilter: false,
    sortingFn: (a: { original: SortEntry }, b: { original: SortEntry }) => comparePresetEntries(a.original, b.original, preset, foldersFirst),
  }));
}
