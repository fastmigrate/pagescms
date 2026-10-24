"use client";

import { useState } from "react";
import { EntryForm } from "@/components/entry/entry-form";
import { Button } from "@/components/ui/button";
import { ConfigProvider } from "@/contexts/config-context";
import { optionalObjectFixtures } from "@/lib/dev-fixtures/optional-objects";
import { sanitizeObject } from "@/lib/schema";
import type { Config } from "@/types/config";

const config: Config = {
  owner: "fixture", repo: "optional-objects", branch: "main", sha: "fixture", version: "3.0",
  object: { media: [] },
};
const loadConfig = async () => config;

export function OptionalObjectsFixture() {
  const [scenario, setScenario] = useState<keyof typeof optionalObjectFixtures>("services");
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null);
  const [saveCount, setSaveCount] = useState(0);
  const fixture = optionalObjectFixtures[scenario];

  const selectScenario = (next: keyof typeof optionalObjectFixtures) => {
    setScenario(next);
    setSaved(null);
    setSaveCount(0);
  };

  return <ConfigProvider value={config} loadConfig={loadConfig}>
    <main className="mx-auto grid max-w-5xl gap-6 px-6 py-10">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Optional objects</h1>
        <p className="text-sm text-muted-foreground">
          The production entry form saves to memory. Edit the title and save.
          Empty optional media must stay absent, including hidden media and collapsed list items.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => selectScenario("services")}>Services shape</Button>
          <Button variant="outline" onClick={() => selectScenario("contact")}>Contact shape</Button>
        </div>
      </header>
      <div className="grid items-start gap-8 md:grid-cols-2">
        <section className="grid gap-6 rounded-lg border p-5">
          <EntryForm key={scenario} fields={fixture.fields} contentObject={fixture.content}
            onSubmit={(values) => { setSaved(sanitizeObject(values)); setSaveCount((count) => count + 1); }} />
          <Button type="submit" form="entry-form">Save</Button>
        </section>
        <section className="grid gap-3 rounded-lg border p-5">
          <p role="status">Successful saves: {saveCount}</p>
          <pre aria-label="Saved content" className="overflow-x-auto text-xs leading-5">{JSON.stringify(saved, null, 2)}</pre>
        </section>
      </div>
    </main>
  </ConfigProvider>;
}
