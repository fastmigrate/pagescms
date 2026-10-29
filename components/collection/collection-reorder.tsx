"use client";

import { useCallback, useEffect, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollectionCell } from "./collection-cell";
import type { CollectionColumn } from "@/lib/collection-columns";
import { safeAccess } from "@/lib/schema";
import { requireApiSuccess } from "@/lib/api-client";
import { moveOrder, orderDirty, orderDraft, orderPayload, type OrderEntry, type OrderFilter, type OrderGroup, type OrderGroupDraft, type OrderRequest, type OrderSnapshot, type OrderState } from "@/lib/collection-order";

function OrderRow({ entry, index, count, columns, disabled, move }: {
  entry: OrderEntry; index: number; count: number; columns: readonly CollectionColumn[]; disabled: boolean;
  move: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.path, disabled });
  return <tr ref={setNodeRef} data-order-path={entry.path} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`relative border-b bg-background last:border-b-0 ${isDragging ? "z-10 opacity-70" : ""}`}>
    <td className="p-2 align-top"><Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon-sm" className="touch-none cursor-grab" disabled={disabled}
      {...attributes} {...listeners} aria-label={`${entry.label} ziehen`}><GripVertical className="size-4" /></Button></td>
    {columns.map(column => <td key={column.id} className="max-w-sm whitespace-normal break-words p-3 align-top [overflow-wrap:anywhere]" data-column-id={column.id}>
      <CollectionCell column={column} valueAt={path => safeAccess(entry.fields, path)} />
    </td>)}
    <td className="sticky right-0 bg-background p-2 align-top"><div className="flex gap-1">
      <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.label} nach oben`} disabled={disabled || index === 0} onClick={() => move(index, index - 1)}><ArrowUp className="size-4" /></Button>
      <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.label} nach unten`} disabled={disabled || index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown className="size-4" /></Button>
    </div></td>
  </tr>;
}

function OrderGroupList({ group, draft, columns, showHeading, disabled, move }: {
  group: OrderGroup; draft: OrderGroupDraft; columns: readonly CollectionColumn[]; showHeading: boolean; disabled: boolean;
  move: (groupId: string, from: number, to: number) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const entries = new Map(group.entries.map(entry => [entry.path, entry]));
  const moveEntry = (from: number, to: number) => move(group.id, from, to);
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!disabled && over) moveEntry(draft.paths.indexOf(String(active.id)), draft.paths.indexOf(String(over.id)));
  };
  return <section data-order-group={group.id} aria-label={group.label} className="min-w-0 space-y-2">
    {showHeading && <h3 className="flex items-center gap-2 font-semibold">{group.label}<span className="text-sm font-normal text-muted-foreground">{draft.paths.length} Einträge</span></h3>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={dragEnd}>
      <div className="max-w-full overflow-x-auto rounded-lg border">
        <table aria-label={`Reihenfolge ${group.label}`} className="w-full text-sm text-left">
          <thead className="border-b bg-muted/50"><tr>
            <th scope="col" className="w-12 p-3"><span className="sr-only">Ziehen</span></th>
            {columns.map(column => <th key={column.id} scope="col" className="p-3 font-medium">{column.label}</th>)}
            <th scope="col" className="sticky right-0 w-24 bg-muted p-3">Verschieben</th>
          </tr></thead>
          <SortableContext items={draft.paths} strategy={verticalListSortingStrategy}>
            <tbody>{draft.paths.map((path, index) => {
              const entry = entries.get(path);
              return entry && <OrderRow key={path} entry={entry} index={index} count={draft.paths.length} columns={columns} disabled={disabled} move={moveEntry} />;
            })}</tbody>
          </SortableContext>
        </table>
      </div>
    </DndContext>
    {!draft.paths.length && <p>Dieser Bereich enthält keine Einträge.</p>}
  </section>;
}

export function CollectionReorder({ url, request = fetch, onClose, onSaved, setUpdateBlocked }: {
  url: string; request?: OrderRequest; onClose: () => void; onSaved?: (snapshot: OrderSnapshot) => void;
  setUpdateBlocked?: (blocked: boolean) => void;
}) {
  const [state, setState] = useState<OrderState>({ status: "loading" });
  const [filter, setFilter] = useState<OrderFilter>({ kind: "all" });
  const [saved, setSaved] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const active = state.status === "ready" || state.status === "saving";
  const dirty = active && orderDirty(state);
  const saving = state.status === "saving";
  const blocked = dirty || saving;
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setFilter({ kind: "all" });
    setSaved(false);
    void (async () => {
      try {
        const result = await requireApiSuccess<{ data: OrderSnapshot }>(await request(url, { cache: "no-store" }), "Reihenfolge konnte nicht geladen werden");
        if (!cancelled) setState({ status: "ready", ...orderDraft(result.data) });
      } catch (error) {
        if (!cancelled) setState({ status: "load-error", error: error instanceof Error ? error.message : "Laden fehlgeschlagen" });
      }
    })();
    return () => { cancelled = true; };
  }, [url, request, loadAttempt]);

  useEffect(() => {
    setUpdateBlocked?.(blocked);
    return () => setUpdateBlocked?.(false);
  }, [blocked, setUpdateBlocked]);

  useEffect(() => {
    if (!blocked) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const linkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.download || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (saving || !window.confirm("Ungespeicherte Reihenfolge verwerfen und diese Seite verlassen?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", linkClick, true); };
  }, [blocked, saving]);

  const move = useCallback((groupId: string, from: number, to: number) => {
    setSaved(false);
    setState(current => current.status === "ready" ? {
      ...current,
      groups: current.groups.map(group => group.id === groupId ? { ...group, paths: moveOrder(group.paths, from, to) } : group),
      error: undefined,
    } : current);
  }, []);
  const close = () => {
    if (saving || (dirty && !window.confirm("Ungespeicherte Reihenfolge verwerfen und zur Übersicht zurückkehren?"))) return;
    onClose();
  };
  const save = async () => {
    if (state.status !== "ready" || !dirty) return;
    const draft = state;
    setState({ ...draft, status: "saving", error: undefined });
    try {
      const result = await requireApiSuccess<{ data: OrderSnapshot }>(await request(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orderPayload(draft)),
      }), "Reihenfolge konnte nicht gespeichert werden");
      setState({ status: "ready", ...orderDraft(result.data) });
      setFilter(current => current.kind === "group" && !result.data.groups.some(group => group.id === current.id) ? { kind: "all" } : current);
      setSaved(true);
      onSaved?.(result.data);
    } catch (error) {
      setState({ ...draft, status: "ready", error: error instanceof Error ? error.message : "Speichern fehlgeschlagen" });
    }
  };

  if (!active) return <section className="min-w-0 space-y-4" aria-label="Reihenfolge bearbeiten">
    <Button variant="outline" onClick={onClose}>Zur Übersicht</Button>
    {state.status === "loading" ? <p role="status">Reihenfolge wird geladen…</p> : <><p role="alert">{state.error}</p><Button onClick={() => setLoadAttempt(attempt => attempt + 1)}>Erneut laden</Button></>}
  </section>;
  const multipleGroups = state.groups.length > 1;
  return <section className="min-w-0 space-y-4" aria-label="Reihenfolge bearbeiten" aria-busy={saving}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Reihenfolge bearbeiten</h2><p className="text-sm text-muted-foreground">Innerhalb eines Bereichs verschieben. Erst Speichern übernimmt alle Änderungen.</p></div>
      <Button variant="outline" disabled={saving} onClick={close}>Zur Übersicht</Button>
    </div>
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3 shadow-sm">
      {multipleGroups && <label className="flex items-center gap-2 text-sm">Bereich
        <select className="max-w-full rounded-md border bg-background p-2" aria-label="Bereich" value={filter.kind === "all" ? "" : filter.id} disabled={saving}
          onChange={event => setFilter(event.target.value ? { kind: "group", id: event.target.value } : { kind: "all" })}>
          <option value="">Alle Einträge</option>
          {state.baseline.groups.map(group => <option key={group.id} value={group.id}>{group.label} ({group.entries.length})</option>)}
        </select>
      </label>}
      <p role="status" className="text-sm">{saving ? "Wird gespeichert…" : dirty ? "Ungespeicherte Änderungen" : saved ? "Reihenfolge gespeichert" : "Keine ungespeicherten Änderungen"}</p>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={saving || !dirty} onClick={() => { setState({ status: "ready", ...orderDraft(state.baseline) }); setSaved(false); }}>Verwerfen</Button>
        <Button disabled={saving || !dirty} onClick={() => void save()}>{saving && <LoaderCircle className="size-4 animate-spin" />}Speichern</Button>
      </div>
    </div>
    {state.error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{state.error} Alle Entwürfe bleiben erhalten.</p>}
    <p className="text-xs text-muted-foreground">Ziehen oder Pfeiltasten verwenden. Am Ziehgriff mit Leertaste starten, mit Pfeiltasten verschieben und mit Leertaste ablegen.</p>
    <div className="min-w-0 space-y-6">{state.groups.filter(group => filter.kind === "all" || filter.id === group.id).map(draft => {
      const group = state.baseline.groups.find(group => group.id === draft.id)!;
      return <OrderGroupList key={group.id} group={group} draft={draft} columns={state.baseline.columns} showHeading={multipleGroups} disabled={saving} move={move} />;
    })}</div>
    {!state.groups.length && <p>Diese Sammlung enthält keine Einträge.</p>}
  </section>;
}
