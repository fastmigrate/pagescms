import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Exercise the actual route, schema helpers, JSON parser and image read transform.
// Only authentication/GitHub I/O and unused React field components are replaced.
const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
function fixture() {
  const schema: any = { name: "works", type: "collection", path: "content/works", format: "json", extension: "json", fields: [
    { name: "id", type: "string" }, { name: "title", type: "string" },
    { name: "image", type: "image", options: { media: "art" } },
    { name: "details", type: "object", fields: [{ name: "photo", type: "image", options: { media: "art" } }] },
  ] };
  const config = { object: { content: [schema], media: [
    { name: "default", input: "public", output: "/" },
    { name: "art", input: "website/src/assets/art", output: "/art" },
  ] } };
  let entries: any[] = [];
  let denied = false;
  let reads = 0;
  const registry: any = { readFns: {}, schemas: {}, defaultValues: {} };
  const cache = new Map<string, any>();
  const mocks: Record<string, any> = {
    "@/fields/registry": registry,
    "@/lib/api-repo-context": { getRepoReadContext: async () => {
      if (denied) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { token: "fixture-token", config };
    } },
    "@/lib/github-cache-file": { getCollectionCache: async (...args: any[]) => {
      assert.equal(args[4], "fixture-token"); reads++; return entries;
    } },
  };
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path).exports;
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const require = (specifier: string): any => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier === "./view-component" || specifier === "./edit-component") return {};
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return nativeRequire(specifier);
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => existsSync(file));
      if (!resolved) throw new Error(`Unresolved fixture dependency: ${specifier}`);
      return load(resolved);
    };
    new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  registry.readFns.image = load(resolve(root, "fields/core/image/index.tsx")).read;
  const { GET } = load(resolve(root, "app/api/[owner]/[repo]/[branch]/references/[name]/route.ts"));
  return {
    schema, config, deny: () => { denied = true; }, reads: () => reads,
    setEntries: (values: any[]) => { entries = values.map((value, index) => ({ type: "file", path: `content/works/${index}.json`, name: `${index}.json`, content: JSON.stringify(value) })); },
    request: (params: Record<string, string> = {}, name = "works") => GET(
      { nextUrl: new URL(`https://cms.invalid/api?${new URLSearchParams({ valueTemplate: "{fields.id}", labelTemplate: "{fields.title}", ...params })}`) },
      { params: Promise.resolve({ owner: "fixture", repo: "art", branch: "main", name }) },
    ),
  };
}

test("search and saved-value resolution return the actual transformed image and named media source", async () => {
  const f = fixture();
  f.setEntries([{ id: "one", title: "Untitled", image: "/art/painting.jpg" }, { id: "two", title: "Blue", image: "/art/blue.jpg" }]);
  for (const params of [{ query: "Untitled", searchFields: "title" }, { value: "one" }]) {
    const response = await f.request({ ...params, imageField: "image" });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.options, [{ value: "one", label: "Untitled", image: { path: "website/src/assets/art/painting.jpg", media: "art" } }]);
  }
});

test("nested image fields and multiple images use the first transformed image", async () => {
  const f = fixture();
  f.setEntries([{ id: "one", title: "Nested", details: { photo: ["/art/one.jpg", "/art/two.jpg"] } }]);
  const result = await (await f.request({ imageField: "fields.details.photo" })).json();
  assert.deepEqual(result.data.options[0].image, { path: "website/src/assets/art/one.jpg", media: "art" });
});

test("text-only references and invalid/disabled image configuration remain selectable", async () => {
  const f = fixture();
  f.setEntries([{ id: "one", title: "Untitled", image: "/art/one.jpg" }]);
  for (const imageField of ["", "unknown", "title"]) {
    assert.deepEqual((await (await f.request({ imageField })).json()).data.options, [{ value: "one", label: "Untitled" }]);
  }
  for (const media of [false, "unknown"]) {
    f.schema.fields[2].options.media = media;
    assert.deepEqual((await (await f.request({ imageField: "image" })).json()).data.options, [{ value: "one", label: "Untitled" }]);
  }
});

test("missing/external images preserve labels and default media uses its own mapping", async () => {
  const f = fixture();
  f.setEntries([{ id: "one", title: "No photo" }, { id: "two", title: "External", image: "https://example.com/art.jpg" }]);
  assert.deepEqual((await (await f.request({ imageField: "image" })).json()).data.options.map((item: any) => item.image), [null, null]);
  delete f.schema.fields[2].options.media;
  f.setEntries([{ id: "one", title: "Default", image: "/photo.jpg" }]);
  assert.deepEqual((await (await f.request({ imageField: "image" })).json()).data.options[0].image, { path: "public/photo.jpg", media: "default" });
});

test("empty reference IDs do not shift search results onto a different artwork", async () => {
  const f = fixture();
  f.setEntries([{ id: "", title: "Other", image: "/art/other.jpg" }, { id: "target", title: "Match", image: "/art/match.jpg" }]);
  const result = await (await f.request({ imageField: "image", query: "Match", searchFields: "title" })).json();
  assert.deepEqual(result.data.options, [{ value: "target", label: "Match", image: { path: "website/src/assets/art/match.jpg", media: "art" } }]);
});

test("unauthorized requests cannot read collection entries", async () => {
  const f = fixture(); f.deny();
  const response = await f.request({ imageField: "image" });
  assert.equal(response.status, 403);
  assert.equal(f.reads(), 0);
});
