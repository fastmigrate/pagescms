import { z } from "zod";
import type { SortPreset } from "./collection-sort";

export const ReorderConfigSchema = z.object({
  field: z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/).refine(value => !value.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))),
  sortPreset: z.string().min(1),
}).strict();
export type OrderEntry = Readonly<{ path: string; sha: string; label: string; value: number | null }>;
export type OrderGroup = Readonly<{ id: string; label: string; entries: readonly OrderEntry[] }>;
export type OrderSnapshot = Readonly<{ head: string; configSha: string; field: string; groups: readonly OrderGroup[] }>;
export type OrderGroupDraft = { id: string; paths: string[] };
export type OrderDraft = { baseline: OrderSnapshot; groups: OrderGroupDraft[]; error?: string };
export type OrderFilter = { kind: 'all' } | { kind: 'group'; id: string };
export type OrderState = { status: 'loading' } | { status: 'load-error'; error: string } | ({ status: 'ready' | 'saving' } & OrderDraft);
export type OrderSave = { expectedHead: string; configSha: string; groups: { id: string; baseline: { path: string; sha: string }[]; paths: string[] }[] };
export type OrderRequest = (url: string, init?: RequestInit) => Promise<Response>;
export type ReorderDefinition = { field: string; preset: SortPreset; groupFields: string[]; start: number; step: number; min?: number; max?: number };

export function reorderDefinition(schema: any, resolve: (field: any) => any = field => field): ReorderDefinition {
  const { field: path, sortPreset } = ReorderConfigSchema.parse(schema.view?.reorder);
  if (schema.type !== 'collection' || schema.subfolders !== false || (schema.format ?? ((typeof schema.filename === 'string' ? schema.filename : schema.filename?.template)?.endsWith('.json') ? 'json' : undefined)) !== 'json' || schema.list || schema.view?.layout === 'tree' || schema.view?.node) throw new Error('Manual ordering requires a flat JSON object collection with subfolders: false.');
  const preset = schema.view?.sortPresets?.find((item: SortPreset) => item.name === sortPreset) as SortPreset | undefined;
  const ruleIndex = preset?.fields.findIndex(rule => rule.field === path) ?? -1;
  if (!preset || ruleIndex < 0 || preset.fields[ruleIndex].order !== 'asc' || preset.fields[ruleIndex].values) throw new Error('Manual ordering requires an ascending numeric rule without explicit values in the selected preset.');
  let fields = schema.fields;
  let field: any;
  const parts = path.split('.');
  for (const [index, part] of parts.entries()) {
    field = resolve(fields?.find((candidate: any) => candidate.name === part));
    if (!field || field.list || field.readonly || (index < parts.length - 1 && (field.type !== 'object' || !field.required))) throw new Error('Manual order field requires a writable numeric leaf with required object ancestors.');
    fields = field.fields;
  }
  if (field.type !== 'number') throw new Error('Manual order field must be numeric.');
  const findPrimary = (fields: any[], titleOnly: boolean, prefix = ''): string | undefined => {
    for (const candidate of fields ?? []) {
      const item = resolve(candidate);
      if (!item || item.list) continue;
      const name = prefix ? `${prefix}.${item.name}` : item.name;
      if (!['object', 'block'].includes(item.type) && (!titleOnly || item.name === 'title')) return name;
      if (item.type === 'object') { const nested = findPrimary(item.fields, titleOnly, name); if (nested) return nested; }
    }
  };
  const primary = schema.view?.primary ?? findPrimary(schema.fields, true) ?? findPrimary(schema.fields, false);
  const filename = typeof schema.filename === 'string' ? schema.filename : schema.filename?.template;
  if (filename && [...filename.matchAll(/\{([^}]+)\}/g)].some((match: RegExpMatchArray) => match[1] === path || match[1] === `fields.${path}` || (['primary', 'slug'].includes(match[1]) && primary === path))) throw new Error('Manual order field cannot drive the filename.');
  const { min, max, step: declaredStep } = field.options ?? {};
  if ([min, max].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) || (declaredStep !== undefined && declaredStep !== 'any' && (typeof declaredStep !== 'number' || !Number.isFinite(declaredStep) || declaredStep <= 0)) || (min !== undefined && max !== undefined && min > max)) throw new Error('Unsupported manual order numeric constraints.');
  const step = typeof declaredStep === 'number' ? declaredStep : 1;
  const start = min ?? 1;
  if (typeof declaredStep === 'number' && Math.abs((start - (min ?? 0)) / step - Math.round((start - (min ?? 0)) / step)) > 1e-8) throw new Error('Manual order start must align with the declared step.');
  return { field: path, preset, groupFields: preset.fields.slice(0, ruleIndex).map(rule => rule.field), start, step, min, max };
}
export function orderValues(definition: ReorderDefinition, count: number): number[] {
  let previous = -Infinity;
  return Array.from({ length: count }, (_, index) => {
    let value = definition.start + index * definition.step;
    if (definition.max !== undefined && value > definition.max && (value - definition.max) / definition.step <= 1e-8) value = definition.max;
    const aligned = Math.abs((value - definition.start) / definition.step - index) <= 1e-8;
    if (!Number.isFinite(value) || !aligned || value <= previous || (definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max)) throw new Error('The complete group does not fit the numeric field constraints.');
    previous = value;
    return value;
  });
}
export function orderDirty(draft: OrderDraft): boolean {
  return draft.groups.some(group => {
    const entries = draft.baseline.groups.find(item => item.id === group.id)?.entries ?? [];
    return entries.length !== group.paths.length || entries.some((entry, index) => entry.path !== group.paths[index]);
  });
}
export function moveOrder(paths: readonly string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= paths.length || to >= paths.length || from === to) return [...paths];
  const result = [...paths];
  const [path] = result.splice(from, 1);
  result.splice(to, 0, path);
  return result;
}
export function orderDraft(baseline: OrderSnapshot): OrderDraft {
  return { baseline, groups: baseline.groups.map(group => ({ id: group.id, paths: group.entries.map(entry => entry.path) })) };
}
export function orderPayload(draft: OrderDraft): OrderSave {
  return {
    expectedHead: draft.baseline.head,
    configSha: draft.baseline.configSha,
    groups: draft.groups.map(group => ({
      id: group.id,
      baseline: (draft.baseline.groups.find(item => item.id === group.id)?.entries ?? []).map(({ path, sha }) => ({ path, sha })),
      paths: group.paths,
    })),
  };
}
