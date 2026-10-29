import type { Field } from "../types/field";

export type FallbackColumn = { name: string; label: string; fallback: string[] };
export type CollectionColumnSource = { path: string; field: Field };
export type CollectionColumn = {
  id: string;
  label: string | false;
  sources: CollectionColumnSource[];
  fallback: boolean;
};

export function resolveCollectionColumns(schema: {
  fields?: Field[];
  filename?: string;
  view?: { fields?: (string | FallbackColumn)[] };
}): CollectionColumn[] {
  const findField = (path: string): Field | undefined => {
    let fields = schema.fields;
    let field: Field | undefined;
    for (const part of path.split(".")) {
      field = fields?.find(field => field.name === part);
      fields = field?.type === "object" ? field.fields : undefined;
    }
    return field;
  };
  const direct = (path: string, field: Field): CollectionColumn => ({
    id: path, label: field.label ?? field.name, sources: [{ path, field }], fallback: false,
  });
  const configured = schema.view?.fields;
  const columns = configured?.length
    ? configured.flatMap(column => {
      if (typeof column === "string") {
        const field = findField(column);
        return field && !["object", "block"].includes(field.type) ? [direct(column, field)] : [];
      }
      return [{ id: `display:${column.name}`, label: column.label, fallback: true,
        sources: column.fallback.map(path => ({ path, field: findField(path)! })) }];
    })
    : schema.fields
      ? schema.fields.filter(field => !["object", "block"].includes(field.type) && !field.hidden).map(field => direct(field.name, field))
      : [direct("name", { name: "name", label: "Name", type: "string" })];
  if (!columns.some(column => column.id === "date") && schema.filename?.startsWith("{year}-{month}-{day}")
    && (configured?.includes("date") || !configured)) {
    columns.push(direct("date", { name: "date", label: "Date", type: "date" }));
  }
  return columns;
}

export function selectCollectionSource(column: CollectionColumn, valueAt: (path: string) => unknown): { source: CollectionColumnSource; value: unknown } | undefined {
  for (const source of column.sources) {
    const value = valueAt(source.path);
    if (!column.fallback || (value != null && (typeof value !== "string" || value.trim() !== ""))) return { source, value };
  }
}
