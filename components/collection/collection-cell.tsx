import { viewComponents } from "@/fields/registry";
import { selectCollectionSource, type CollectionColumn } from "@/lib/collection-columns";

export function CollectionCell({ column, valueAt }: { column: CollectionColumn; valueAt: (path: string) => unknown }) {
  const selected = selectCollectionSource(column, valueAt);
  if (!selected) return null;
  const { source, value } = selected;
  const View = viewComponents[source.field.type];
  if (View) return <View value={value} field={source.field} />;
  return <>{Array.isArray(value) ? value.join(", ") : value == null ? null : String(value)}</>;
}
