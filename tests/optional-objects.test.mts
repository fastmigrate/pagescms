import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { mediaFields, optionalMedia, optionalObjectFixtures } from "../lib/dev-fixtures/optional-objects.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

const productionLoader = (boundaries: Record<string, unknown> = {}) => {
  const modules = new Map<string, { exports: any }>();
  const load = (path: string): any => {
    const filename = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`]
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (!filename) throw new Error(`Production module not found: ${path}`);
    if (modules.has(filename)) return modules.get(filename)!.exports;
    const loaded = { exports: {} as any };
    modules.set(filename, loaded);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", code)((name: string) => {
      if (Object.hasOwn(boundaries, name)) return boundaries[name];
      if (/\/(edit|view)-component$/u.test(name)) return {};
      if (name.startsWith("@/")) return load(resolve(root, name.slice(2)));
      if (name.startsWith(".")) return load(resolve(dirname(filename), name));
      return require(name);
    }, loaded, loaded.exports);
    return loaded.exports;
  };
  return (path: string) => load(resolve(root, path));
};

const load = productionLoader();
const { deepMap, initializeState, generateZodSchema, sanitizeObject } = load("lib/schema.ts");
const { readFns, writeFns } = load("fields/registry.ts");
const { parse, stringify } = load("lib/serialization.ts");
const mapFields = (content: any, fields: any[], transforms: Record<string, any> = {}, config = {}) => (
  deepMap(content, fields, (value: unknown, field: any) => (
    transforms[field.type] ? transforms[field.type](value, field, config) : value
  ))
);

for (const [name, fixture] of Object.entries(optionalObjectFixtures)) {
  test(`${name} opens and saves an unrelated title edit without optional media`, () => {
    const read = mapFields(fixture.content, fixture.fields, readFns);
    const state = initializeState(fixture.fields, sanitizeObject(read));
    state.title = "Changed title";
    const result = generateZodSchema(fixture.fields).safeParse(state);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    const written = sanitizeObject(mapFields(result.data, fixture.fields, writeFns));
    assert.deepEqual(written, { ...fixture.content, title: "Changed title" });
    assert.deepEqual(parse(stringify(written, { format: "json" }), { format: "json" }), written);
  });
}

test("empty optional objects never receive child defaults or generated identities", () => {
  const fields = [{ ...optionalMedia, fields: [...mediaFields, { name: "id", type: "uuid" }] }];
  for (const value of [undefined, null, "", {}, { src: "" }, { src: null, focalPoint: { x: "", y: undefined } }]) {
    const read = mapFields({ media: value }, fields, readFns);
    const state = initializeState(fields, read);
    assert.equal(state.media, undefined);
    assert.deepEqual(sanitizeObject(state), {});
    const parsed = generateZodSchema(fields).parse({ media: value });
    assert.deepEqual(sanitizeObject(mapFields(parsed, fields, writeFns)), {});
  }
});

test("a populated optional object receives hidden defaults before validation and writing", () => {
  const fields = [optionalMedia];
  const content = { media: { src: "website/assets/photo.png", alt: "Saved description", focalPoint: { x: 0, y: 0.5 } } };
  const config = { object: { media: [{ name: "media", input: "website/assets", output: "/media" }] } };
  const parsed = generateZodSchema(fields).parse(content);
  const written = sanitizeObject(mapFields(parsed, fields, writeFns, config));
  assert.deepEqual(written, {
    media: { ...content.media, src: "/media/photo.png", role: "content", presentation: "cover" },
  });
  assert.deepEqual(sanitizeObject(mapFields(written, fields, readFns, config)), {
    media: { ...content.media, role: "content", presentation: "cover" },
  });
});

test("nested optional parents stay absent until meaningful content exists", () => {
  const fields = [{ name: "wrapper", type: "object", fields: [
    { name: "id", type: "uuid" }, optionalMedia,
  ] }];
  assert.deepEqual(sanitizeObject(initializeState(fields, {})), {});
  const parsed = generateZodSchema(fields).parse({ wrapper: { media: { src: "/media/photo.png" } } });
  assert.match(parsed.wrapper.id, /^[0-9a-f-]{36}$/u);
  assert.equal(parsed.wrapper.media.role, "content");
  assert.equal(parsed.wrapper.media.presentation, "cover");
});

test("false and zero keep optional objects present and existing metadata wins over defaults", () => {
  const fields = [{ name: "settings", type: "object", fields: [
    { name: "enabled", type: "boolean" },
    { name: "order", type: "number" },
    { name: "label", type: "string", required: true, default: "Default label" },
  ] }, optionalMedia];
  const parsed = generateZodSchema(fields).parse({
    settings: { enabled: false, order: 0 },
    media: { src: "/media/photo.png", role: "decorative", presentation: "contain" },
  });
  assert.deepEqual(sanitizeObject(parsed), {
    settings: { enabled: false, order: 0, label: "Default label" },
    media: { src: "/media/photo.png", role: "decorative", presentation: "contain" },
  });
});

test("required objects and populated optional objects still enforce required descendants", () => {
  const schema = generateZodSchema([optionalMedia]);
  for (const media of [{ alt: "Missing file" }, { role: "content", presentation: "cover" }, { src: "", role: "content" }]) {
    const result = schema.safeParse({ media });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((issue: any) => issue.path.join(".") === "media.src"));
  }
  const required = generateZodSchema([{ ...optionalMedia, required: true }]);
  assert.equal(required.safeParse({}).success, false);
  assert.equal(required.safeParse({ media: {} }).success, false);
  for (const media of [true, 42, "not an object", ["not an object"], new Date("2026-01-01")]) {
    assert.equal(schema.safeParse({ media }).success, false);
  }
});

test("object-list bounds, block discriminators and nested optional media retain their contracts", () => {
  const fields = [{
    name: "sections", type: "block", required: true, list: { min: 1, max: 2 }, blockKey: "kind",
    blocks: [{ name: "gallery", fields: [{ name: "title", type: "string", required: true }, optionalMedia] }],
  }];
  const content = { sections: [{ kind: "gallery", title: "First" }, { kind: "gallery", title: "Second", media: { src: "/media/photo.png" } }] };
  const parsed = generateZodSchema(fields).parse(initializeState(fields, content));
  assert.deepEqual(sanitizeObject(mapFields(parsed, fields)), {
    sections: [content.sections[0], { ...content.sections[1], media: { src: "/media/photo.png", role: "content", presentation: "cover" } }],
  });
  assert.equal(generateZodSchema(fields).safeParse({ sections: [] }).success, false);
  assert.equal(generateZodSchema(fields).safeParse({ sections: [...content.sections, content.sections[0]] }).success, false);
  assert.equal(generateZodSchema(fields).safeParse({ sections: [{ kind: "unknown", title: "Invalid" }] }).success, false);
});

test("the normal save API omits empty containers and writes defaults for populated objects", async () => {
  const fields = optionalObjectFixtures.contact.fields;
  const config = {
    sha: "configuration-sha",
    object: { content: [{ name: "contact", type: "file", path: "content/contact.json", format: "json", extension: "json", fields }] },
  };
  const writes: Record<string, any>[] = [];
  let session: any = { user: { id: "editor", name: "Editor" } };
  let repoAllowed = true;
  const octokit = { rest: { repos: {
    get: async () => {
      if (!repoAllowed) throw new Error("Repository access denied");
      return { data: {} };
    },
    createOrUpdateFileContents: async (input: Record<string, any>) => {
      writes.push(input);
      return { data: {
        content: { type: "file", name: "contact.json", path: input.path, sha: "saved-sha", size: input.content.length },
        commit: { sha: "commit-sha" },
      } };
    },
  } } };
  const routeLoad = productionLoader({
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth": { auth: { api: { getSession: async () => session } } },
    "@/lib/github-account": { getGithubAccount: async () => ({ accessToken: "fixture-token" }) },
    "@octokit/app": {},
    "@/lib/utils/octokit": { createOctokitInstance: () => octokit },
    "@/db": { db: { query: { collaboratorTable: { findFirst: async () => undefined } } } },
    "@/lib/config-store": { getConfig: async () => config },
    "@/lib/config": {},
    "@/lib/github-cache-file": { updateFileCache: async () => {} },
    "@/lib/github-media-metadata": {},
  });
  const route = routeLoad("app/api/[owner]/[repo]/[branch]/files/[path]/route.ts");
  const save = (content: Record<string, unknown>, configSha = config.sha) => route.POST(
    new Request("https://cms.example.test/api/fixture/repo/main/files/content%2Fcontact.json", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://cms.example.test", host: "cms.example.test" },
      body: JSON.stringify({ type: "content", name: "contact", configSha, sha: "previous-sha", content }),
    }),
    { params: Promise.resolve({ owner: "fixture", repo: "repo", branch: "main", path: "content/contact.json" }) },
  );
  assert.equal((await save(optionalObjectFixtures.contact.content)).status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(writes[0].content, "base64").toString()), optionalObjectFixtures.contact.content);
  assert.equal((await save({ title: "Image added", hero: { media: { src: "/media/photo.png" } } })).status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(writes[1].content, "base64").toString()), {
    title: "Image added", hero: { media: { src: "/media/photo.png", role: "content", presentation: "cover" } },
  });
  assert.equal((await save({ title: "Invalid media", hero: { media: { alt: "Missing source" } } })).status, 400);
  assert.equal((await save({ title: "Empty media", hero: { media: { src: "", alt: "" } }, listing: {} })).status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(writes[2].content, "base64").toString()), { title: "Empty media" });
  assert.equal((await save({ title: "Stale configuration" }, "obsolete-sha")).status, 409);
  session = null;
  assert.equal((await save({ title: "Unauthorized" })).status, 401);
  session = { user: { id: "editor" } };
  repoAllowed = false;
  assert.equal((await save({ title: "Forbidden" })).status, 403);
  assert.equal(writes.length, 3);
});
