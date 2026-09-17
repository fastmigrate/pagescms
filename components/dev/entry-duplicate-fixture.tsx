"use client";

import { useState } from "react";
import { FlaskConical, GitCommitHorizontal, RotateCcw, ShieldCheck } from "lucide-react";
import type { ApiSuccess, EntryData } from "@/types/api";
import { EntryDuplicate } from "@/components/entry/entry-duplicate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createDuplicateFixtureResponse } from "@/lib/dev-fixtures";

const schema = {
  name: "jobs",
  label: "Stellenangebote",
  type: "collection",
  path: "website/src/content/jobs",
  format: "json",
  extension: "json",
  filename: "{primary}.json",
  operations: {
    duplicate: {
      label: "Duplizieren",
      description: "Erstellt eine neue Stelle aus dem zuletzt gespeicherten Stand.",
      field: "title",
      fieldLabel: "Titel der neuen Stelle",
      button: "Duplizieren",
      draft: true,
    },
  },
  view: { primary: "title" },
  fields: [
    { name: "title", label: "Titel", type: "string", required: true },
    { name: "draft", label: "Entwurf", type: "boolean" },
    { name: "description", label: "Beschreibung", type: "text" },
  ],
};

const savedSource = {
  title: "Mitarbeiter Produktion / Küche",
  draft: false,
  description: "Gespeicherter Inhalt aus dem Fixture.",
};

export function EntryDuplicateFixture() {
  const [result, setResult] = useState<ApiSuccess<EntryData> | null>(null);
  const [requestCount, setRequestCount] = useState(0);

  const duplicateEntry = async (value: string) => {
    setRequestCount((count) => count + 1);
    await new Promise((resolve) => setTimeout(resolve, 180));
    return createDuplicateFixtureResponse(value);
  };

  return (
    <main className="min-h-screen bg-muted/35 px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="grid gap-4 border-l-4 border-primary pl-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Badge variant="outline" className="gap-1.5 bg-background">
              <FlaskConical className="size-3.5" /> Development fixture
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Native entry duplication
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              The production component runs against deterministic saved content,
              without authentication, PostgreSQL, GitHub requests, or commits.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5">
              <ShieldCheck className="size-3.5 text-primary" /> no external writes
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5">
              <GitCommitHorizontal className="size-3.5 text-primary" /> request {requestCount}
            </span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle>{savedSource.title}</CardTitle>
                  <CardDescription>
                    website/src/content/jobs/mitarbeiter-produktion-kueche.json
                  </CardDescription>
                </div>
                <EntryDuplicate
                  owner="fixture"
                  repo="pagescms-development"
                  branch="main"
                  name="jobs"
                  path="website/src/content/jobs/mitarbeiter-produktion-kueche.json"
                  schema={schema}
                  duplicateEntry={duplicateEntry}
                  onDuplicated={setResult}
                />
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6">
              <div className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Saved source
                </span>
                <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-4 font-mono text-xs leading-5">
                  {JSON.stringify(savedSource, null, 2)}
                </pre>
              </div>
              <p className="text-sm text-muted-foreground">
                Open <strong className="font-medium text-foreground">Duplizieren</strong>,
                enter a new title, and submit. The fixture records the component result locally.
              </p>
            </CardContent>
          </Card>

          <Card className={result ? "border-primary/45" : undefined}>
            <CardHeader className="border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">Observed result</CardTitle>
                  <CardDescription>
                    Immediate UI feedback before a PR or VM build.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reset fixture result"
                  onClick={() => setResult(null)}
                  disabled={!result}
                >
                  <RotateCcw className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {result ? (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <p className="text-sm font-medium">{result.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Draft: {String(result.data.contentObject?.draft)}
                    </p>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-4 font-mono text-xs leading-5">
                    {JSON.stringify(result.data.contentObject, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-lg border border-dashed p-6 text-center">
                  <div className="space-y-2">
                    <FlaskConical className="mx-auto size-6 text-muted-foreground" />
                    <p className="text-sm font-medium">No duplicate submitted</p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      The result appears here without navigating away from the fixture.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
