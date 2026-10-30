import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as sort from "../lib/collection-sort.ts";
import * as reorder from "../lib/collection-order.ts";
import { isMediaOperationAllowed } from "../lib/operations.ts";

const require = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, any> = {}) {
  const loaded = { exports: {} as any };
  const compiled = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)((id: string) => id in mocks ? mocks[id] : require(id), loaded, loaded.exports);
  return loaded.exports;
}
const schema = load("lib/config-schema.ts", {
  "@/fields/registry": { fieldTypes: new Set(["file", "string"]) },
  "./collection-sort": sort, "./collection-order": reorder,
});
const normalizer = load("lib/config.ts", {
  "@/lib/utils/file": load("lib/utils/file.ts"), "@/lib/config-schema": schema,
});

test("media operation schema accepts independent opt-ins and rejects invalid or extra options", () => {
  const source = { input: "media/catalogues", output: "/downloads" };
  for (const operations of [undefined, {}, { delete: false }, { rename: false }, { delete: true, rename: true }, { delete: false, rename: false }]) {
    for (const media of [{ ...source, operations }, [{ ...source, name: "catalogues", operations }]]) {
      const result = schema.ConfigSchema.safeParse({ media });
      assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    }
  }
  for (const operations of [false, "false", { delete: "false" }, { rename: 0 }, { create: false }, { delet: false }]) {
    assert.equal(schema.ConfigSchema.safeParse({ media: { ...source, operations } }).success, false, JSON.stringify(operations));
  }
  assert.equal(schema.ConfigSchema.safeParse({ media: "media/catalogues" }).success, true);
});

test("media input normalization resolves dot and slash segments while preserving output and operations", () => {
  const source = { name: "catalogues", input: "/public//drafts/../catalogues/./", output: "/downloads", operations: { delete: false, rename: false } };
  const normalized = normalizer.normalizeConfig({ media: [source] });
  assert.equal(normalized.media[0].input, "public/catalogues");
  assert.equal(normalized.media[0].output, "/downloads");
  assert.deepEqual(normalized.media[0].operations, source.operations);
  assert.equal(source.input, "/public//drafts/../catalogues/./");
  assert.equal(isMediaOperationAllowed("delete", { configObject: normalized, paths: ["public/catalogues/old.pdf"] }), false);
  assert.equal(isMediaOperationAllowed("delete", { configObject: normalized, paths: ["public/catalogues-other/old.pdf"] }), true);
});

test("path policy denies any containing protected root without changing defaults or sibling directories", () => {
  const configObject = { media: [
    { input: "public", operations: { delete: true } },
    { input: "public/catalogues", operations: { delete: false } },
  ] };
  for (const path of ["public/catalogues", "public/catalogues/old.pdf", "public/catalogues/archive/old.pdf"]) {
    assert.equal(isMediaOperationAllowed("delete", { configObject, paths: [path] }), false);
    assert.equal(isMediaOperationAllowed("rename", { configObject, paths: [path] }), true);
  }
  for (const path of ["public/catalogues-other/old.pdf", "other/public/catalogues/old.pdf", "public/photo.jpg"]) {
    assert.equal(isMediaOperationAllowed("delete", { configObject, paths: [path] }), true);
  }
  for (const media of [undefined, false, [], [{ input: "public/catalogues" }]]) {
    assert.equal(isMediaOperationAllowed("delete", { configObject: { media }, paths: ["public/catalogues/old.pdf"] }), true);
  }
  assert.equal(isMediaOperationAllowed("delete", { configObject: null, paths: ["old.pdf"] }), true);
  assert.equal(isMediaOperationAllowed("delete", { configObject: { media: [{ input: "", operations: { delete: false } }] }, paths: ["old.pdf"] }), false);
});
