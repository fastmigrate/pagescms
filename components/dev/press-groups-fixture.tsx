"use client";

import { useCallback, useState } from "react";
import { SWRConfig } from "swr";
import { Collection } from "@/components/collection/collection";
import { RepoHeaderProvider, useRepoHeaderState } from "@/components/repo/repo-header-context";
import { ConfigProvider } from "@/contexts/config-context";
import { readFns } from "@/fields/registry";
import { resolveCollectionColumns } from "@/lib/collection-columns";
import type { OrderRequest } from "@/lib/collection-order";
import type { Config } from "@/types/config";

type PressEntry = {
  slug: string;
  title: string;
  source: string;
  publishedDate: string;
  section: "press" | "tv";
  showOnHome: boolean;
  draft: boolean;
};

const entries: PressEntry[] = [
  {
    slug: "besuchergruppe-aus-der-region",
    title: "Besuchergruppe aus der Region",
    source: "Regionalzeitung",
    publishedDate: "2024-11-29",
    section: "press",
    showOnHome: false,
    draft: false,
  },
  {
    slug: "erbseneintopf-im-fernsehbeitrag",
    title: "Erbseneintopf im Fernsehbeitrag",
    source: "Beispielsender",
    publishedDate: "2025-05-18",
    section: "tv",
    showOnHome: true,
    draft: false,
  },
  {
    slug: "huehnersuppe-im-fernsehbeitrag",
    title: "Hühnersuppe im Fernsehbeitrag",
    source: "Beispielsender",
    publishedDate: "2025-04-27",
    section: "tv",
    showOnHome: false,
    draft: false,
  },
  {
    slug: "manufaktur-feiert-betriebsjubilaeum",
    title: "Manufaktur feiert Betriebsjubiläum",
    source: "Lokalzeitung",
    publishedDate: "2025-06-02",
    section: "press",
    showOnHome: false,
    draft: false,
  },
  {
    slug: "rinderfond-im-produkttest",
    title: "Rinderfond im Produkttest",
    source: "Genussmagazin",
    publishedDate: "2024-11-14",
    section: "press",
    showOnHome: true,
    draft: false,
  },
];

const config: Config = {
  owner: "fixture",
  repo: "press-groups",
  branch: "main",
  sha: "press-groups-config-0",
  version: "3.0",
  object: {
    content: [{
      name: "press",
      label: "Pressebeiträge",
      type: "collection",
      path: "content/press",
      format: "json",
      extension: "json",
      filename: "{primary}.json",
      subfolders: false,
      operations: { create: false, rename: false, delete: false },
      fields: [
        { name: "title", label: "Titel", type: "string", required: true },
        { name: "source", label: "Quelle / Medium", type: "string", required: true },
        { name: "publishedDate", label: "Veröffentlichungsdatum", type: "date", required: true, options: { format: "yyyy-MM-dd" } },
        { name: "section", label: "Bereich", type: "select", required: true, options: { values: [{ name: "press", label: "Presse" }, { name: "tv", label: "TV" }] } },
        { name: "showOnHome", label: "Auf der Startseite zeigen", type: "boolean", default: false },
        { name: "draft", label: "Entwurf / nicht anzeigen", type: "boolean", default: true },
      ],
      view: {
        groupBy: "section",
        primary: "title",
        fields: ["title", "source", "publishedDate", "section", "showOnHome", "draft"],
        sortPresets: [{
          name: "website",
          label: "Website",
          fields: [
            { field: "section", order: "asc", values: ["press", "tv"] },
            { field: "publishedDate", order: "desc" },
          ],
        }],
        default: { sortPreset: "website" },
        search: ["title", "source"],
      },
    }],
  },
};

const columns = resolveCollectionColumns(config.object.content[0]);
const loadConfig = async () => config;

function FixtureHeader() {
  return <header>{useRepoHeaderState().header}</header>;
}

export function PressGroupsFixture() {
  const [counts, setCounts] = useState({ reads: 0, rejectedWrites: 0 });
  const request = useCallback<OrderRequest>(async (input, init) => {
    if ((init?.method ?? "GET").toUpperCase() !== "GET") {
      setCounts(current => ({ ...current, rejectedWrites: current.rejectedWrites + 1 }));
      return Response.json({ status: "error", message: "This preview is read-only." }, { status: 405 });
    }
    const url = new URL(input, "http://fixture.local");
    if (url.pathname !== "/api/fixture/press-groups/main/collections/press") {
      return Response.json({ status: "error", message: "Unknown fixture request." }, { status: 404 });
    }
    setCounts(current => ({ ...current, reads: current.reads + 1 }));
    return Response.json({
      status: "success",
      data: {
        contents: entries.map(entry => ({
          path: `content/press/${entry.slug}.json`,
          name: `${entry.slug}.json`,
          sha: `fixture-${entry.slug}`,
          type: "file",
          fields: Object.fromEntries(columns.flatMap(column => column.sources.map(({ path, field }) => {
            const value = entry[path as keyof PressEntry];
            const transformed = readFns[field.type]?.(value, field, config);
            return [path, transformed === undefined ? value : transformed];
          }))),
        })),
      },
    });
  }, []);

  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <ConfigProvider value={config} loadConfig={loadConfig}>
        <RepoHeaderProvider>
          <main className="mx-auto grid max-w-screen-2xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
            <FixtureHeader />
            <Collection name="press" request={request} />
            <output className="sr-only" data-testid="fixture-counts">
              Leseanfragen {counts.reads}. Abgewiesene Schreibanfragen {counts.rejectedWrites}.
            </output>
          </main>
        </RepoHeaderProvider>
      </ConfigProvider>
    </SWRConfig>
  );
}
