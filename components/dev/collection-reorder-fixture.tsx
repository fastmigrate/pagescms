"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { SWRConfig } from "swr";
import { Collection } from "@/components/collection/collection";
import { RepoHeaderProvider, useRepoHeaderState } from "@/components/repo/repo-header-context";
import { Button } from "@/components/ui/button";
import { ConfigProvider } from "@/contexts/config-context";
import type { OrderRequest, OrderSave, OrderSnapshot } from "@/lib/collection-order";
import { resolveCollectionColumns } from "@/lib/collection-columns";
import { readFns } from "@/fields/registry";
import type { Config } from "@/types/config";

const config: Config = {
  owner: "fixture", repo: "collection-reorder", branch: "main", sha: "config-0", version: "3.0",
  object: { content: [{ name: "jobs", label: "Stellen", type: "collection", path: "content/jobs", format: "json", extension: "json", filename: "{fields.id}.json", subfolders: false,
    operations: { create: false, delete: false, rename: false },
    fields: [{ name: "id", type: "string" }, { name: "title", label: "Titel", type: "string" }, { name: "department", label: "Bereich", type: "string" }, { name: "publishedDate", label: "Datum", type: "date", options: { format: "dd.MM.yyyy" } }, { name: "eventLabel", label: "Zeitraum", type: "string" }, { name: "featured", label: "Startseite", type: "boolean" }, { name: "draft", label: "Entwurf", type: "boolean" }, { name: "sortOrder", label: "Reihenfolge", type: "number", hidden: true, options: { min: 1, step: 1 } }],
    view: { primary: "title", fields: ["title", { name: "dateOrEvent", label: "Datum / Zeitraum", fallback: ["publishedDate", "eventLabel"] }, "department", "sortOrder", "featured", "draft"], layout: "list", sortPresets: [{ name: "website", label: "Website", fields: [{ field: "department", order: "asc" }, { field: "sortOrder", order: "asc" }, { field: "id", order: "asc" }] }], default: { sortPreset: "website" }, reorder: { field: "sortOrder", sortPreset: "website" } },
  }] },
};
type Document = { id: string; title: string; department: string; sortOrder: number; publishedDate: string; eventLabel: string; featured: boolean; draft: boolean; hidden: { enabled: boolean; zero: number; empty: null; unknown: string[] } };
const initialDocuments = Object.fromEntries(["Beratung", "Verwaltung"].flatMap((department, group) => Array.from({ length: group === 0 ? 32 : 3 }, (_, index) => {
  const id = `${group === 0 ? "beratung" : "verwaltung"}-${String(index + 1).padStart(2, "0")}`;
  return [`content/jobs/${id}.json`, { id, title: `${department} ${String(index + 1).padStart(2, "0")}`, department, sortOrder: index + 1,
    publishedDate: index % 3 === 0 ? "29.10.2026" : "", eventLabel: index % 3 === 2 ? "   " : "Herbst 2026", featured: index % 2 === 0, draft: index % 2 === 1,
    hidden: { enabled: false, zero: 0, empty: null, unknown: [id, "behalten"] } } satisfies Document];
})));
const columns = resolveCollectionColumns(config.object.content[0]);
const displayFields = (document: Document) => Object.fromEntries(columns.flatMap(column => column.sources.map(({ path, field }) => {
  const value = document[path as keyof Document];
  const read = readFns[field.type];
  const transformed = read?.(value, field, config);
  return [path, transformed === undefined ? value : transformed];
})));
const loadConfig = async () => config;
function FixtureHeader() { return <div>{useRepoHeaderState().header}</div>; }

export function CollectionReorderFixture({ singleGroup = false }: { singleGroup?: boolean }) {
  const documents = useRef<Record<string, Document>>(structuredClone(Object.fromEntries(Object.entries(initialDocuments).filter(([, document]) => !singleGroup || document.department === "Beratung"))));
  const revision = useRef(0);
  const shas = useRef(Object.fromEntries(Object.keys(initialDocuments).map(path => [path, `blob-0-${path}`])));
  const mode = useRef<"normal" | "error" | "conflict" | "delay">("normal");
  const release = useRef<(() => void) | null>(null);
  const [nextMode, setNextMode] = useState(mode.current);
  const [pending, setPending] = useState(false);
  const [counts, setCounts] = useState({ reads: 0, posts: 0, saves: 0 });
  const snapshot = useCallback((): OrderSnapshot => ({ head: `head-${revision.current}`, configSha: config.sha, field: "sortOrder", columns,
    groups: (singleGroup ? ["Beratung"] : ["Beratung", "Verwaltung"]).map(department => ({ id: department, label: department,
      entries: Object.entries(documents.current).filter(([, doc]) => doc.department === department).sort(([, a], [, b]) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map(([path, doc]) => ({ path, sha: shas.current[path], label: doc.title, value: doc.sortOrder, fields: displayFields(doc) })),
    })),
  }), [singleGroup]);
  const request = useCallback<OrderRequest>(async (input, init) => {
    const url = new URL(input, "http://fixture.local");
    if (init?.method !== "POST") {
      setCounts(current => ({ ...current, reads: current.reads + 1 }));
      if (url.pathname.endsWith("/order")) return Response.json({ status: "success", data: snapshot() });
      return Response.json({ status: "success", data: { contents: Object.entries(documents.current).map(([path, doc]) => ({ path, name: path.split("/").at(-1), sha: shas.current[path], type: "file", fields: displayFields(doc) })) } });
    }
    if (!url.pathname.endsWith("/order")) throw new Error("Die Fixture erlaubt nur die Reihenfolge-Speichergrenze.");
    setCounts(current => ({ ...current, posts: current.posts + 1 }));
    const behavior = mode.current;
    mode.current = "normal";
    setNextMode("normal");
    if (behavior === "delay") {
      setPending(true);
      await new Promise<void>(resolve => { release.current = resolve; });
      release.current = null;
      setPending(false);
    }
    if (behavior === "error") return Response.json({ status: "error", message: "Simulierter Speicherfehler. Bitte erneut versuchen." }, { status: 503 });
    const payload = JSON.parse(String(init?.body)) as OrderSave;
    const current = snapshot();
    if (behavior === "conflict" || payload.expectedHead !== current.head || payload.configSha !== current.configSha
      || payload.groups.length !== current.groups.length || new Set(payload.groups.map(group => group.id)).size !== current.groups.length) return Response.json({ status: "error", message: "Konflikt. Der gespeicherte Stand wurde geändert. Entwurf verwerfen und neu öffnen." }, { status: 409 });
    for (const draft of payload.groups) {
      const group = current.groups.find(group => group.id === draft.id);
      if (!group || JSON.stringify(draft.baseline) !== JSON.stringify(group.entries.map(({ path, sha }) => ({ path, sha })))) return Response.json({ status: "error", message: "Konflikt. Der gespeicherte Stand wurde geändert." }, { status: 409 });
      if (new Set(draft.paths).size !== group.entries.length || draft.paths.length !== group.entries.length || draft.paths.some(path => !group.entries.some(entry => entry.path === path))) return Response.json({ status: "error", message: "Unvollständige Gruppe." }, { status: 400 });
    }
    const changed = payload.groups.filter(draft => draft.paths.some((path, index) => current.groups.find(group => group.id === draft.id)!.entries[index].path !== path));
    if (!changed.length) return Response.json({ status: "success", data: current });
    revision.current += 1;
    for (const draft of changed) draft.paths.forEach((path, index) => {
      documents.current[path] = { ...documents.current[path], sortOrder: index + 1 };
      shas.current[path] = `blob-${revision.current}-${path}`;
    });
    setCounts(current => ({ ...current, saves: current.saves + 1 }));
    return Response.json({ status: "success", data: snapshot() });
  }, [snapshot]);
  return <SWRConfig value={{ provider: () => new Map() }}><ConfigProvider value={config} loadConfig={loadConfig}><RepoHeaderProvider>
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Sammlungsreihenfolge testen</h1>
        <p>Die echte Sammlungsansicht speichert ausschließlich synthetische JSON-Dokumente im Arbeitsspeicher. Beratung enthält 32 Einträge{!singleGroup && ", Verwaltung enthält 3"}.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">Nächster Speicherversuch <select aria-label="Nächster Speicherversuch" className="ml-2 rounded border bg-background p-2" value={nextMode} disabled={pending} onChange={event => {
            mode.current = event.target.value as typeof nextMode;
            setNextMode(mode.current);
          }}><option value="normal">Erfolg</option><option value="delay">Antwort anhalten</option><option value="error">Fehler</option><option value="conflict">Konflikt</option></select></label>
          <Button variant="outline" disabled={!pending} onClick={() => release.current?.()}>Antwort freigeben</Button>
          <Link href="/dev/fixtures/entry-save-reset" className="text-sm underline">Andere Fixture öffnen</Link>
        </div>
        <p role="status" data-testid="fixture-counts">Leseanfragen {counts.reads}. Schreibanfragen {counts.posts}. Erfolgreich gespeichert {counts.saves}. Antwort wartet {pending ? "ja" : "nein"}.</p>
      </header>
      <section className="grid gap-4 rounded-lg border p-4 sm:p-6"><FixtureHeader /><Collection name="jobs" request={request} /></section>
      <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Gespeicherte Reihenfolge und vollständige Dokumente</summary>
        <pre aria-label="Gespeicherte Gruppen" className="mt-3 overflow-x-auto text-xs">{JSON.stringify(snapshot(), null, 2)}</pre>
        <pre aria-label="Gespeicherte Dokumente" className="mt-3 overflow-x-auto text-xs">{JSON.stringify(documents.current, null, 2)}</pre>
      </details>
    </main>
  </RepoHeaderProvider></ConfigProvider></SWRConfig>;
}
