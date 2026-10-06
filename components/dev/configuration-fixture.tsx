"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigProvider, useConfig } from "@/contexts/config-context";
import { ConfigurationNotice } from "@/components/entry/configuration-notice";
import { EntryForm } from "@/components/entry/entry-form";
import { Entry } from "@/components/entry/entry";
import { RepoHeaderProvider, useRepoHeaderState } from "@/components/repo/repo-header-context";
import { Button } from "@/components/ui/button";
import type { Config } from "@/types/config";

const oldConfig: Config = {
  owner: "fixture", repo: "configuration", branch: "main", sha: "old", version: "3.0",
  object: { content: [{ name: "articles", type: "collection", path: "content", format: "json", extension: "json", view: { primary: "title" }, fields: [
    { name: "title", label: "Title", type: "string" },
    { name: "description", label: "SEO description", type: "text" },
  ] }] },
};
const newConfig: Config = { ...oldConfig, sha: "new", object: { content: [{ name: "articles", type: "collection", path: "content", format: "json", extension: "json", view: { primary: "title" }, fields: [
  { name: "title", label: "Title", type: "string" },
  { name: "seoTitle", label: "SEO title", type: "string" },
  { name: "description", label: "SEO description", type: "text" },
] }] } };
const savedContent = { title: "Aries and Taurus", seoTitle: "Aries and Taurus compatibility", description: "Saved description" };
function FixtureEditor() {
  const { config, setUpdateBlocked, refreshConfig } = useConfig();
  const draftRef = useRef<(() => Promise<Record<string, unknown>>) | null>(null);
  const dirty = useCallback((value: boolean) => setUpdateBlocked(value), [setUpdateBlocked]);
  useEffect(() => () => setUpdateBlocked(false), [setUpdateBlocked]);
  return <><Button onClick={() => void refreshConfig()}>Check configuration</Button>
    <EntryForm key={config!.sha} fields={config!.object.content[0].fields} contentObject={savedContent}
      onSubmit={() => {}} onDirtyChange={dirty} draftRef={draftRef}
      onChangeRegistered={() => setUpdateBlocked(true)}
      notice={<ConfigurationNotice filename="fixture" getDraft={() => draftRef.current?.() ?? {}} />} /></>;
}
function FixtureHeader() {
  return <div>{useRepoHeaderState().header}</div>;
}
export function ConfigurationFixture() {
  const [latest, setLatest] = useState<Config | null>(oldConfig);
  const checkFailure = useRef(false);
  const [fullEditor, setFullEditor] = useState(false);
  const savedRef = useRef(savedContent);
  const [saveCount, setSaveCount] = useState(0);
  const latestRef = useRef(latest);

  const loadConfig = useCallback(async () => {
    if (checkFailure.current) throw new Error("Fixture check failed");
    return latestRef.current;
  }, []);
  const request = useCallback<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://fixture.local");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.configSha !== latestRef.current?.sha) return Response.json({ status: "error", message: "Configuration changed. Your draft is kept." }, { status: 409 });
      setSaveCount((count) => count + 1);
      savedRef.current = body.content;
      return Response.json({ status: "success", message: "Saved fixture", data: { sha: "saved-file", path: "content/page.json" } });
    }
    if (url.pathname.endsWith("/history")) return Response.json({ status: "success", data: [] });
    if (url.searchParams.get("configSha") !== latestRef.current?.sha) return Response.json({ status: "error", message: "Configuration changed. Your draft is kept." }, { status: 409 });
    return Response.json({ status: "success", data: { sha: "file", path: "content/page.json", contentObject: savedRef.current } });
  }, []);
  return <main className="mx-auto max-w-3xl p-8 space-y-6">
    <h1 className="text-2xl font-semibold">CMS configuration update</h1>
    <p>The production provider and form use isolated configuration and saved content.</p>
    <Button onClick={() => { latestRef.current = newConfig; setLatest(newConfig); }}>Publish SEO title configuration</Button>
    <Button onClick={() => { latestRef.current = null; setLatest(null); }}>Remove configuration</Button>
    <Button onClick={() => { checkFailure.current = !checkFailure.current; }}>Toggle check failure</Button>
    <Button onClick={() => setFullEditor(true)}>Use full entry editor</Button>
    <p>Repository configuration: {latest?.sha ?? "missing"}</p>
    <p>Successful saves: {saveCount}</p>
    <ConfigProvider value={oldConfig} loadConfig={loadConfig}><RepoHeaderProvider>{fullEditor ? <><FixtureHeader /><Entry name="articles" path="content/page.json" request={request} /></> : <FixtureEditor />}</RepoHeaderProvider></ConfigProvider>
  </main>;
}
