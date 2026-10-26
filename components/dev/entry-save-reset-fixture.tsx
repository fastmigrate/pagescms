"use client";

import { useCallback, useRef, useState } from "react";
import { Entry } from "@/components/entry/entry";
import { RepoHeaderProvider, useRepoHeaderState } from "@/components/repo/repo-header-context";
import { Button } from "@/components/ui/button";
import { ConfigProvider } from "@/contexts/config-context";
import { sanitizeObject } from "@/lib/schema";
import type { Config } from "@/types/config";

const path = "content/settings.json";
const config: Config = {
  owner: "fixture", repo: "entry-save-reset", branch: "main", sha: "fixture-config", version: "3.0",
  object: { content: [{
    name: "settings", type: "file", path, format: "json", fields: [
      { name: "title", label: "Title", type: "string", required: true },
      { name: "contact", label: "Contact", type: "object", fields: [
        { name: "hours", label: "Opening hours", type: "object", fields: [
          { name: "days", label: "Hours days", type: "string" },
          { name: "from", label: "Hours from", type: "string" },
          { name: "until", label: "Hours until", type: "string" },
        ] },
      ] },
      { name: "social", label: "Social", type: "object", fields: [
        { name: "defaultImageAlt", label: "Image description", type: "string" },
      ] },
      { name: "notes", label: "Notes", type: "object", list: { collapsible: false }, fields: [
        { name: "text", label: "Note", type: "string", default: "New note" },
      ] },
      { name: "controls", type: "object", hidden: true, fields: [
        { name: "enabled", type: "boolean" },
        { name: "count", type: "number" },
      ] },
    ],
  }] },
};
const initialContent = {
  title: "Site settings",
  contact: { hours: { days: "Monday to Friday", from: "08:00", until: "17:00" } },
  social: { defaultImageAlt: "Saved image description" },
  notes: [{ text: "Original note" }],
  controls: { enabled: false, count: 0 },
};
const loadConfig = async () => config;

type SaveRecord = { submittedSha: string; sha: string; content: Record<string, unknown> };

function FixtureHeader() {
  return <div>{useRepoHeaderState().header}</div>;
}

export function EntrySaveResetFixture() {
  const savedRef = useRef({ sha: "fixture-file-0", content: initialContent as Record<string, unknown> });
  const holdNextRef = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const [holdNext, setHoldNext] = useState(false);
  const [pending, setPending] = useState(false);
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const revisionRef = useRef(0);

  const request = useCallback<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://fixture.local");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.configSha !== config.sha || body.sha !== savedRef.current.sha) {
        return Response.json({ status: "error", message: "Fixture revision conflict" }, { status: 409 });
      }
      const content = sanitizeObject(body.content) as Record<string, unknown>;
      if (holdNextRef.current) {
        holdNextRef.current = false;
        setHoldNext(false);
        setPending(true);
        await new Promise<void>((resolve) => { releaseRef.current = resolve; });
        releaseRef.current = null;
        setPending(false);
      }
      const sha = JSON.stringify(content) === JSON.stringify(savedRef.current.content)
        ? savedRef.current.sha
        : `fixture-file-${++revisionRef.current}`;
      savedRef.current = { sha, content };
      setSaves((history) => [...history, { submittedSha: body.sha, sha, content }]);
      return Response.json({ status: "success", message: "Saved fixture", data: { sha, path } });
    }
    if (url.pathname.endsWith("/history")) return Response.json({ status: "success", data: [] });
    return Response.json({
      status: "success",
      data: { sha: savedRef.current.sha, path, contentObject: savedRef.current.content },
    });
  }, []);

  return <ConfigProvider value={config} loadConfig={loadConfig}>
    <RepoHeaderProvider>
      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold">Entry save reset</h1>
          <p>The production entry editor saves to memory. Clear the optional fields, save, and edit again without reloading.</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending || holdNext} onClick={() => {
              holdNextRef.current = true;
              setHoldNext(true);
            }}>Hold next save</Button>
            <Button variant="outline" disabled={!pending} onClick={() => releaseRef.current?.()}>Release saved response</Button>
          </div>
          <p>Next save held: {holdNext ? "yes" : "no"}. Save pending: {pending ? "yes" : "no"}.</p>
        </header>
        <div className="grid items-start gap-8 md:grid-cols-2">
          <section className="grid gap-6 rounded-lg border p-5">
            <FixtureHeader />
            <Entry name="settings" path={path} request={request} />
          </section>
          <section className="grid gap-3 rounded-lg border p-5">
            <p role="status">Successful saves: {saves.length}</p>
            <pre aria-label="Saved content" className="overflow-x-auto text-xs leading-5">{JSON.stringify(savedRef.current.content, null, 2)}</pre>
            <pre aria-label="Save history" className="overflow-x-auto text-xs leading-5">{JSON.stringify(saves, null, 2)}</pre>
          </section>
        </div>
      </main>
    </RepoHeaderProvider>
  </ConfigProvider>;
}
