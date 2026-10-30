"use client";

import { useCallback, useMemo, useState } from "react";
import { SWRConfig, type Middleware } from "swr";
import { ConfigProvider } from "@/contexts/config-context";
import { editComponents, schemas } from "@/fields/registry";
import { FileOptions } from "@/components/file/file-options";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { MediaItem } from "@/types/api";
import type { Config } from "@/types/config";

const originalPath = "media/catalogue-october.pdf";
const selectedPath = "media/catalogue-november.pdf";
const config: Config = {
  owner: "fixture", repo: "catalogue", branch: "main", sha: "fixture-config", version: "fixture",
  object: { media: [{ name: "catalogues", input: "media", output: "/media", extensions: ["pdf"], rename: false, operations: { delete: false, rename: false } }] },
};
const initialAssets: MediaItem[] = [originalPath, selectedPath].map(path => ({
  type: "file", name: path.split("/").pop()!, path, extension: "pdf", sha: `fixture-${path}`, size: 16,
}));
const field = { name: "catalogue", type: "file", label: "Catalogue", required: true, options: { media: "catalogues", rename: false } };
const EditComponent = editComponents.file;
const validator = schemas.file(field, config.object);

export function CatalogExchangeFixture() {
  const [assets, setAssets] = useState(initialAssets);
  const [draft, setDraft] = useState<string | undefined>(originalPath);
  const [saved, setSaved] = useState<string | undefined>(originalPath);
  const [failUpload, setFailUpload] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [failDelete, setFailDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const record = useCallback((event: string) => setEvents(previous => [...previous, event]), []);
  const onChange = useCallback((value: string | string[] | undefined) => setDraft(typeof value === "string" ? value : undefined), []);
  const fixtureMiddleware = useMemo<Middleware>(() => next => (key, _fetcher, options) => next(key, async (): Promise<any> => {
    if (typeof key === "string" && key.endsWith("/configuration")) return config;
    if (typeof key === "string" && key.includes("/media/catalogues/")) return assets;
    throw new Error(`Unexpected fixture read: ${String(key)}`);
  }, { ...options, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0 }), [assets]);

  return <SWRConfig value={{ provider: () => new Map(), use: [fixtureMiddleware] }}>
    <ConfigProvider value={config} loadConfig={async () => config}>
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Catalogue exchange fixture</h1>
        <p>Production file field and library menu with in-memory assets. Remove changes the draft reference. The modeled Save boundary uses the production required-file validator. Library Delete removes a physical asset immediately.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label><input type="checkbox" checked={failUpload} onChange={event => setFailUpload(event.target.checked)} /> Fail upload</label>
          <label><input type="checkbox" checked={failSave} onChange={event => setFailSave(event.target.checked)} /> Fail save</label>
          <label><input type="checkbox" checked={failDelete} onChange={event => setFailDelete(event.target.checked)} /> Fail delete</label>
        </div>
        <section aria-label="Catalogue field" className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium">Catalogue</h2>
          <EditComponent key={resetKey} value={saved} field={field} onChange={onChange} uploadFile={async (path: string) => {
            record(`upload ${path}`);
            if (failUpload) throw new Error("Upload failed. Existing files are unchanged.");
            let target = path;
            let suffix = 1;
            while (assets.some(asset => asset.path === target)) target = path.replace(/\.pdf$/, `-${suffix++}.pdf`);
            const item: MediaItem = { type: "file", name: target.split("/").pop()!, path: target, extension: "pdf", sha: `fixture-upload-${events.length}`, size: 16 };
            setAssets(previous => [...previous, item]);
            return { path: item.path, name: item.name, sha: item.sha };
          }} />
          <Button type="button" disabled={draft === saved} onClick={() => {
            const result = validator.safeParse(draft);
            if (!result.success) { setMessage(result.error.issues[0].message); return; }
            record(`save ${draft ?? "(empty)"}`);
            if (failSave) { setMessage("Save failed. The saved reference is unchanged."); return; }
            setSaved(draft);
            setMessage("Reference saved.");
          }}>Save</Button>
          <p role="status">{message}</p>
        </section>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>Saved reference</dt><dd data-testid="saved-reference">{saved ?? "(empty)"}</dd>
          <dt>Draft reference</dt><dd data-testid="draft-reference">{draft ?? "(empty)"}</dd>
          <dt>Saved reference exists</dt><dd data-testid="saved-reference-exists">{!saved || assets.some(asset => asset.path === saved) ? "yes" : "no"}</dd>
        </dl>
        <section aria-label="Media library" className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium">Physical media assets</h2>
          {assets.map(asset => <div key={asset.path} className="flex items-center justify-between gap-3" data-testid="library-asset">
            <span>{asset.path}</span>
            <FileOptions path={asset.path} sha={asset.sha!} type="media" name="catalogues" deleteFile={async path => {
              record(`delete ${path}`);
              if (failDelete) throw new Error("Delete failed. Existing files are unchanged.");
              setAssets(previous => previous.filter(item => item.path !== path));
              return { message: `Deleted ${path}` };
            }}><Button type="button" variant="outline" aria-label={`Options for ${asset.name}`}>Options</Button></FileOptions>
          </div>)}
        </section>
        <pre data-testid="fixture-events" className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(events)}</pre>
        <Button type="button" variant="outline" onClick={() => {
          setAssets(initialAssets); setDraft(originalPath); setSaved(originalPath); setMessage(""); setEvents([]);
          setFailUpload(false); setFailSave(false); setFailDelete(false); setResetKey(previous => previous + 1);
        }}>Reset fixture</Button>
      </main>
      <Toaster />
    </ConfigProvider>
  </SWRConfig>;
}
