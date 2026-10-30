"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import useSWR, { SWRConfig, type Middleware } from "swr";
import { Entry } from "@/components/entry/entry";
import { RepoHeaderProvider, useRepoHeaderState } from "@/components/repo/repo-header-context";
import { Button } from "@/components/ui/button";
import { ConfigProvider } from "@/contexts/config-context";
import type { Config } from "@/types/config";
import type { EntryData, MediaItem } from "@/types/api";

type Mode = "object" | "list" | "code";
type Write = { operation: "rename" | "save"; path: string; body: Record<string, unknown>; status: number };
const media = ["old", "missing", "replacement"].map<MediaItem>((name) => ({
  type: "file", name: `${name}.pdf`, path: `media/${name}.pdf`, extension: "pdf", sha: `fixture-${name}`, size: 16,
}));

function FixtureHeader() {
  return <div>{useRepoHeaderState().header}</div>;
}

const collisionConfig: Config = {
  owner: "fixture", repo: "entry-create-collision", branch: "main", sha: "fixture-config", version: "3.0",
  object: { content: [{
    name: "articles", type: "collection", path: "content", format: "json", extension: "json", filename: "{primary}.json", filenameField: true,
    fields: [{ name: "title", label: "Title", type: "string" }],
  }] },
};
const originalEntry: EntryData = {
  path: "content/original.json", name: "original.json", sha: "fixture-original", contentObject: { title: "Original saved title" },
};
const allocatedPath = "content/original-1.json";
const collisionEntryUrl = (path: string) => `/api/fixture/entry-create-collision/main/entries/${encodeURIComponent(path)}?name=articles&configSha=fixture-config`;
const loadCollisionConfig = async () => collisionConfig;

function CollisionCacheEntries() {
  const { data: original } = useSWR(collisionEntryUrl(originalEntry.path), async () => originalEntry, { revalidateOnFocus: false });
  const { data: created } = useSWR<EntryData>(collisionEntryUrl(allocatedPath), null);
  return <>
    <pre aria-label="Original entry cache">{JSON.stringify(original ?? null)}</pre>
    <pre aria-label="Created entry cache">{JSON.stringify(created ?? null)}</pre>
  </>;
}

export function EntryCreateCollisionFixture() {
  const [writes, setWrites] = useState<{ path: string; body: Record<string, unknown> }[]>([]);
  const [navigation, setNavigation] = useState("");
  const router = useRouter();
  const fixtureRouter = useMemo(() => ({ ...router, replace: setNavigation, push: setNavigation }), [router]);
  const request = useCallback<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://fixture.local");
    if (init?.method !== "POST") throw new Error(`Unexpected fixture request ${url.pathname}`);
    const body = JSON.parse(String(init.body));
    const path = decodeURIComponent(url.pathname.split("/files/")[1]);
    if (path !== originalEntry.path || body.sha != null || body.configSha !== collisionConfig.sha) {
      return Response.json({ status: "error", message: "Fixture create conflict" }, { status: 409 });
    }
    setWrites((history) => [...history, { path, body }]);
    return Response.json({ status: "success", message: "Created fixture", data: {
      path: allocatedPath, name: "original-1.json", sha: "fixture-created",
    } });
  }, []);

  return <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
    <AppRouterContext.Provider value={fixtureRouter}>
      <ConfigProvider value={collisionConfig} loadConfig={loadCollisionConfig}>
        <RepoHeaderProvider>
          <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
            <h1 className="text-2xl font-semibold">Entry create filename collision</h1>
            <section className="grid gap-6 rounded-lg border p-5">
              <FixtureHeader />
              <Entry name="articles" request={request} />
            </section>
            <CollisionCacheEntries />
            <pre aria-label="Write history">{JSON.stringify(writes)}</pre>
            <p aria-label="Navigation target">{navigation}</p>
          </main>
        </RepoHeaderProvider>
      </ConfigProvider>
    </AppRouterContext.Provider>
  </SWRConfig>;
}

export function EntryRenameFixture({ mode }: { mode: Mode }) {
  const initialPath = `content/original.${mode === "code" ? "md" : "json"}`;
  const config = useMemo<Config>(() => ({
    owner: "fixture", repo: `entry-rename-${mode}`, branch: "main", sha: "fixture-config", version: "3.0",
    object: {
      media: [{ name: "documents", input: "media", output: "/media", extensions: ["pdf"] }],
      content: [{
        name: "articles", type: "collection", path: "content", format: mode === "code" ? "raw" : "json",
        extension: mode === "code" ? "md" : "json", filenameField: true, ...(mode === "list" ? { list: true } : {}),
        ...(mode === "code" ? {} : { fields: [
          { name: "title", label: "Title", type: "string" },
          { name: "document", label: "Document", type: "file", options: { media: "documents" } },
        ] }),
      }],
    },
  }), [mode]);
  const initialContent = mode === "code" ? { body: "Saved text media/old.pdf" }
    : mode === "list" ? [{ title: "Saved title", document: "media/old.pdf" }]
      : { title: "Saved title", document: "media/old.pdf" };
  const savedRef = useRef({ path: initialPath, sha: "fixture-file-0", content: initialContent });
  const latestConfigRef = useRef(config);
  const [latestConfig, setLatestConfig] = useState(config);
  const revisionRef = useRef(0);
  const releaseRenameRef = useRef<(() => void) | null>(null);
  const releaseReadRef = useRef<(() => void) | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [readFailure, setReadFailure] = useState(false);
  const readFailureRef = useRef(false);
  const [writes, setWrites] = useState<Write[]>([]);
  const [navigation, setNavigation] = useState("");
  const router = useRouter();
  const fixtureRouter = useMemo(() => ({ ...router, replace: setNavigation, push: setNavigation }), [router]);
  const loadConfig = useCallback(async () => latestConfigRef.current, []);
  const middleware = useMemo<Middleware>(() => (next) => (key, fetcher, options) => {
    if (typeof key === "string" && key.includes("/media/documents/")) return next(key, async (): Promise<any> => media, options);
    return next(key, fetcher, options);
  }, []);
  const request = useCallback<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://fixture.local");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const filePath = decodeURIComponent(url.pathname.split("/files/")[1].replace(/\/rename$/, ""));
      const rename = url.pathname.endsWith("/rename");
      if (filePath !== savedRef.current.path || body.sha !== savedRef.current.sha) {
        setWrites((history) => [...history, { operation: rename ? "rename" : "save", path: filePath, body, status: 409 }]);
        return Response.json({ status: "error", message: "Fixture path or revision conflict" }, { status: 409 });
      }
      if (rename) {
        setRenamePending(true);
        await new Promise<void>((resolve) => { releaseRenameRef.current = resolve; });
        releaseRenameRef.current = null;
        savedRef.current.path = body.newPath;
        setRenamePending(false);
        setWrites((history) => [...history, { operation: "rename", path: filePath, body, status: 200 }]);
        return Response.json({ status: "success", message: "Renamed fixture", data: { path: filePath, newPath: body.newPath } });
      }
      const missing = JSON.stringify(body.content).includes("media/missing.pdf");
      setWrites((history) => [...history, { operation: "save", path: filePath, body, status: missing ? 409 : 200 }]);
      if (missing) return Response.json({ status: "error", message: "The selected file no longer exists. Select or upload a replacement before saving." }, { status: 409 });
      savedRef.current = { path: filePath, sha: `fixture-file-${++revisionRef.current}`, content: body.content };
      return Response.json({ status: "success", message: "Saved fixture", data: { path: filePath, sha: savedRef.current.sha } });
    }
    if (url.pathname.endsWith("/history")) return Response.json({ status: "success", data: [] });
    const snapshot = { path: savedRef.current.path, name: savedRef.current.path.split("/").pop(), sha: savedRef.current.sha, contentObject: structuredClone(savedRef.current.content) };
    if (snapshot.path !== initialPath) {
      setReadPending(true);
      await new Promise<void>((resolve) => { releaseReadRef.current = resolve; });
      releaseReadRef.current = null;
      setReadPending(false);
      if (readFailureRef.current) return Response.json({ status: "error", message: "Fixture destination read failed" }, { status: 503 });
    }
    return Response.json({ status: "success", data: snapshot });
  }, [initialPath]);

  return <SWRConfig value={{ provider: () => new Map(), use: [middleware], shouldRetryOnError: false }}>
    <AppRouterContext.Provider value={fixtureRouter}>
      <ConfigProvider value={latestConfig} loadConfig={loadConfig}>
        <RepoHeaderProvider>
          <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
            <h1 className="text-2xl font-semibold">Entry rename draft preservation</h1>
            <div className="flex flex-wrap gap-3">
              <Button disabled={!renamePending} onClick={() => releaseRenameRef.current?.()}>Release rename</Button>
              <Button disabled={!readPending} onClick={() => releaseReadRef.current?.()}>Release destination read</Button>
              <label><input type="checkbox" checked={readFailure} onChange={(event) => { readFailureRef.current = event.target.checked; setReadFailure(event.target.checked); }} /> Fail destination read</label>
              <Button onClick={() => {
                latestConfigRef.current = { ...config, sha: "updated-config" };
                setLatestConfig(latestConfigRef.current);
              }}>Publish configuration update</Button>
            </div>
            <p>Rename pending: {renamePending ? "yes" : "no"}. Destination read pending: {readPending ? "yes" : "no"}.</p>
            <section className="grid gap-6 rounded-lg border p-5">
              <FixtureHeader />
              <Entry name="articles" path={initialPath} request={request} />
            </section>
            <pre aria-label="Write history">{JSON.stringify(writes, null, 2)}</pre>
            <pre aria-label="Saved content">{JSON.stringify(savedRef.current.content, null, 2)}</pre>
            <p aria-label="Saved path">{savedRef.current.path}</p>
            <p aria-label="Navigation target">{navigation}</p>
          </main>
        </RepoHeaderProvider>
      </ConfigProvider>
    </AppRouterContext.Provider>
  </SWRConfig>;
}
