"use client";

import { useCallback, useMemo, useState } from "react";
import { SWRConfig, type Middleware } from "swr";
import { ConfigProvider } from "@/contexts/config-context";
import { RepoProvider } from "@/contexts/repo-context";
import { editComponents } from "@/fields/registry";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { Config } from "@/types/config";
import type { FileSaveData, MediaItem } from "@/types/api";

const config: Config = {
  owner: "fixture", repo: "image-ai-status", branch: "main", sha: "fixture", version: "fixture",
  object: {
    mediaMetadata: "data/media-metadata.json",
    media: [{ name: "images", input: "media", extensions: ["jpg", "png", "svg"], rename: false }],
  },
};
const initialAssets: MediaItem[] = ["generated", "modified", "unmarked", "stale"].map((classification) => ({
  type: "file", name: `${classification}.jpg`, path: `media/${classification}.jpg`, extension: "jpg", sha: classification,
  ai: {
    classification: classification === "stale" ? "unmarked" : classification as "generated" | "modified" | "unmarked",
    record: { classification: classification === "stale" ? "generated" : classification as "generated" | "modified" | "unmarked" },
    revision: classification, stale: classification === "stale",
  },
}));
const fixtureImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224"><rect width="224" height="224" fill="#e7dfd1"/><circle cx="112" cy="112" r="72" fill="#f8f4ea"/><path d="M68 108h88v36H68z" fill="#976d4b"/><path d="M72 94h80v30H72z" fill="#b65e43"/><path d="M74 82h76v20H74z" fill="#6d8857"/></svg>')}`;
const resolveImageUrl = async () => fixtureImage;
const loadConfig = async () => config;
const EditComponent = editComponents.image;
type Scenario = "generated" | "modified" | "unmarked" | "stale" | "error" | "missing" | "slow" | "empty";

function ImageField({ scenario, multiple, readonly, onUpload }: {
  scenario: Scenario;
  multiple: boolean;
  readonly: boolean;
  onUpload: (path: string, payload: Record<string, unknown>) => Promise<FileSaveData>;
}) {
  const initialValue = multiple ? ["media/generated.jpg", "media/modified.jpg"] : scenario === "empty" ? "" : `media/${["error", "slow"].includes(scenario) ? "generated" : scenario}.jpg`;
  const [draft, setDraft] = useState<string | string[]>(initialValue);
  const [saved, setSaved] = useState<string | string[]>(initialValue);
  const onChange = useCallback((value: string | string[]) => setDraft(value), []);
  return <>
    <section aria-label="Image field" className="space-y-4 rounded-lg border p-5">
      <h2 className="font-medium">Recipe image</h2>
      <EditComponent value={initialValue} field={{ name: "image", type: "image", readonly, options: { media: "images", multiple } }} onChange={onChange} uploadFile={onUpload} />
      <Button onClick={() => setSaved(draft)}>Save recipe</Button>
    </section>
    <pre aria-label="Saved image reference" className="text-xs">{JSON.stringify(saved)}</pre>
  </>;
}

export function ImageAiStatusFixture() {
  const [scenario, setScenario] = useState<Scenario>("generated");
  const [multiple, setMultiple] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [uploads, setUploads] = useState<{ path: string; classification: string }[]>([]);
  const [assets, setAssets] = useState(initialAssets);
  const middleware = useMemo<Middleware>(() => next => (key, _fetcher, options) => next(key, async (): Promise<any> => {
    if (typeof key === "string" && key.endsWith("/configuration")) return config;
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 1200));
    if (scenario === "error") throw new Error("Fixture metadata unavailable");
    return assets;
  }, { ...options, shouldRetryOnError: false, revalidateOnFocus: false, refreshInterval: 0 }), [scenario, assets]);
  const uploadFile = useCallback(async (path: string, payload: Record<string, unknown>): Promise<FileSaveData> => {
    const classification = payload.classification as "generated" | "modified" | "unmarked";
    const item: MediaItem = {
      type: "file", path, name: path.split("/").pop()!, extension: path.split(".").pop(), sha: `uploaded-${path}`,
      ai: { classification, record: { classification }, revision: `uploaded-${path}`, stale: false },
    };
    setAssets(previous => [...previous.filter(asset => asset.path !== path), item]);
    setUploads(previous => [...previous, { path, classification }]);
    return { ...item, url: undefined };
  }, []);
  return <SWRConfig key={`${scenario}-${multiple}-${readonly}`} value={{ provider: () => new Map(), use: [middleware] }}>
    <ConfigProvider value={config} loadConfig={loadConfig}>
      <RepoProvider repo={{ id: 0, ownerId: 0, owner: config.owner, repo: config.repo, isPrivate: true }} resolveImageUrl={resolveImageUrl}>
        <main className="mx-auto max-w-2xl space-y-5 p-8">
          <h1 className="text-2xl font-semibold">Existing image AI status</h1>
          <p className="text-sm text-muted-foreground">The production image field and upload flow use in-memory media responses. Saving a recipe only saves its image reference.</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label>Scenario <select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value as Scenario)} className="rounded border p-1">
              {["generated", "modified", "unmarked", "stale", "error", "missing", "slow", "empty"].map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label><input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} /> Multiple images</label>
            <label><input type="checkbox" checked={readonly} onChange={event => setReadonly(event.target.checked)} /> Readonly</label>
          </div>
          <ImageField scenario={scenario} multiple={multiple} readonly={readonly} onUpload={uploadFile} />
          <pre aria-label="Uploaded files" className="text-xs">{JSON.stringify(uploads)}</pre>
          <Toaster />
        </main>
      </RepoProvider>
    </ConfigProvider>
  </SWRConfig>;
}
