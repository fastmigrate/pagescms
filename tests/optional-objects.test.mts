import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";
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
  const config = { content: [{ name: "contact", type: "file", path: "content/contact.json", fields }] };
  const f = cmsGitFixture(config, { "content/contact.json": {} });
  const save = (content: Record<string, unknown>, data = {}) => f.save("content/contact.json", content, { name: "contact", ...data });
  assert.equal((await save(optionalObjectFixtures.contact.content)).status, 200);
  assert.deepEqual(f.json("content/contact.json"), optionalObjectFixtures.contact.content);
  assert.equal((await save({ title: "Image added", hero: { media: { src: "/media/photo.png" } } })).status, 200);
  assert.deepEqual(f.json("content/contact.json"), { title: "Image added", hero: { media: { src: "/media/photo.png", role: "content", presentation: "cover" } } });
  assert.equal((await save({ title: "Invalid media", hero: { media: { alt: "Missing source" } } })).status, 400);
  assert.equal((await save({ title: "Empty media", hero: { media: { src: "", alt: "" } }, listing: {} })).status, 200);
  assert.deepEqual(f.json("content/contact.json"), { title: "Empty media" });
  assert.equal((await save({ title: "Stale configuration" }, { configSha: "obsolete-sha" })).status, 409);
  f.signedIn = false; assert.equal((await save({ title: "Unauthorized" })).status, 401);
  f.signedIn = true; f.allowed = false; assert.equal((await save({ title: "Forbidden" })).status, 403);

  const source = { title: "Original", futureNull: null, metadata: { summary: "", futureNull: null, futureEmpty: "", futureObject: {}, futureList: [] }, items: [{ title: "First", metadata: { summary: null, futureEmpty: "" } }, { title: "Second", future: "keep" }] };
  const metadata = { name: "metadata", type: "object", fields: [{ name: "summary", type: "string" }] };
  const duplicate = cmsGitFixture({ content: [{ name: "contact", type: "collection", path: "content", filename: "{primary}.json", view: { primary: "title" }, operations: { duplicate: true }, fields: [{ name: "title", type: "string", required: true }, metadata, { name: "items", type: "object", list: true, fields: [{ name: "title", type: "string" }, metadata] }] }] }, { "content/original.json": source });
  const response = await duplicate.save("content/original.json", undefined, { name: "contact", sha: undefined, duplicate: { value: "Copy" } });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(duplicate.json("content/copy.json"), { ...source, title: "Copy", metadata: { futureNull: null, futureEmpty: "", futureObject: {}, futureList: [] }, items: [{ title: "First", metadata: { futureEmpty: "" } }, { title: "Second", future: "keep" }] });
});
