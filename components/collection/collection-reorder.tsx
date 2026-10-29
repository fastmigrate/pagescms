"use client";

import { useCallback, useEffect, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireApiSuccess } from "@/lib/api-client";
import { moveOrder, orderDirty, orderDraft, orderPayload, type OrderEntry, type OrderRequest, type OrderSnapshot, type OrderState } from "@/lib/collection-order";

function OrderRow({ entry, index, rank, count, disabled, move }: {
  entry: OrderEntry; index: number; rank: number; count: number; disabled: boolean;
  move: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.path, disabled });
  return <li ref={setNodeRef} data-order-path={entry.path} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`relative flex items-center gap-3 border-b bg-background p-3 last:border-b-0 ${isDragging ? "z-10 opacity-70" : ""}`}>
    <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon-sm" className="shrink-0 touch-none cursor-grab" disabled={disabled}
      {...attributes} {...listeners} aria-label={`${entry.label} ziehen`}><GripVertical className="size-4" /></Button>
    <span className="w-8 shrink-0 text-center tabular-nums" aria-label="Entwurfsposition">{index + 1}</span>
    <div className="min-w-0 flex-1"><p className="font-medium break-words">{entry.label}</p>
      <p className="text-xs text-muted-foreground break-all">{entry.path}</p>
      <p className="text-xs text-muted-foreground">Gespeicherter Platz {rank}, Wert {entry.value ?? "nicht gesetzt"}</p></div>
    <div className="flex shrink-0 gap-1">
      <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.label} nach oben`} disabled={disabled || index === 0} onClick={() => move(index, index - 1)}><ArrowUp className="size-4" /></Button>
      <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.label} nach unten`} disabled={disabled || index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown className="size-4" /></Button>
    </div>
  </li>;
}

export function CollectionReorder({ url, request = fetch, onClose, onSaved, setUpdateBlocked }: {
  url: string; request?: OrderRequest; onClose: () => void; onSaved?: (snapshot: OrderSnapshot) => void;
  setUpdateBlocked?: (blocked: boolean) => void;
}) {
  const [state, setState] = useState<OrderState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const active = state.status === "ready" || state.status === "saving";
  const dirty = active && orderDirty(state);
  const saving = state.status === "saving";
  const blocked = dirty || saving;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
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

  const move = useCallback((from: number, to: number) => {
    setState(current => current.status === "ready" ? { ...current, paths: moveOrder(current.paths, from, to), error: undefined } : current);
  }, []);
  const dragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!active || saving || !over) return;
    move(state.paths.indexOf(String(dragged.id)), state.paths.indexOf(String(over.id)));
  };
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
      setState({ status: "ready", ...orderDraft(result.data, draft.groupId) });
      onSaved?.(result.data);
    } catch (error) {
      setState({ ...draft, status: "ready", error: error instanceof Error ? error.message : "Speichern fehlgeschlagen" });
    }
  };

  if (!active) return <section className="space-y-4" aria-label="Reihenfolge bearbeiten">
    <Button variant="outline" onClick={onClose}>Zur Übersicht</Button>
    {state.status === "loading" ? <p role="status">Reihenfolge wird geladen…</p> : <><p role="alert">{state.error}</p><Button onClick={() => setLoadAttempt(attempt => attempt + 1)}>Erneut laden</Button></>}
  </section>;
  const group = state.baseline.groups.find(item => item.id === state.groupId);
  const entries = new Map(group?.entries.map((entry, index) => [entry.path, { entry, rank: index + 1 }]));
  return <section className="space-y-4" aria-label="Reihenfolge bearbeiten" aria-busy={saving}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Reihenfolge bearbeiten</h2><p className="text-sm text-muted-foreground">Alle Einträge der Gruppe. Erst Speichern ändert die gespeicherten Werte.</p></div>
      <Button variant="outline" disabled={saving} onClick={close}>Zur Übersicht</Button>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">Gruppe
        <select className="max-w-full rounded-md border bg-background p-2" aria-label="Gruppe" value={state.groupId} disabled={saving} onChange={event => {
          if (!dirty || window.confirm("Ungespeicherte Reihenfolge verwerfen und Gruppe wechseln?")) setState({ status: "ready", ...orderDraft(state.baseline, event.target.value) });
        }}>{state.baseline.groups.map(item => <option key={item.id} value={item.id}>{item.label} ({item.entries.length})</option>)}</select>
      </label>
      <p role="status" className="text-sm">{saving ? "Wird gespeichert…" : dirty ? "Ungespeicherte Änderungen" : "Keine ungespeicherten Änderungen"}</p>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={saving || !dirty} onClick={() => setState({ status: "ready", ...orderDraft(state.baseline, state.groupId) })}>Verwerfen</Button>
        <Button disabled={saving || !dirty} onClick={() => void save()}>{saving && <LoaderCircle className="size-4 animate-spin" />}Speichern</Button>
      </div>
    </div>
    {state.error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{state.error} Der Entwurf bleibt erhalten.</p>}
    <p className="text-xs text-muted-foreground">Ziehen oder Pfeiltasten verwenden. Am Ziehgriff mit Leertaste starten, mit Pfeiltasten verschieben und mit Leertaste ablegen.</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={dragEnd}>
      <SortableContext items={state.paths} strategy={verticalListSortingStrategy}>
        <ol aria-label="Vollständige Gruppenreihenfolge" className="overflow-hidden rounded-lg border">{state.paths.map((path, index) => {
          const item = entries.get(path);
          return item && <OrderRow key={path} {...item} index={index} count={state.paths.length} disabled={saving} move={move} />;
        })}</ol>
      </SortableContext>
    </DndContext>
    {!state.paths.length && <p>Diese Gruppe enthält keine Einträge.</p>}
  </section>;
}
