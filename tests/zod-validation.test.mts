import * as reorder from "../lib/collection-order.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { zodResolver } from "@hookform/resolvers/zod";
import * as sort from "../lib/collection-sort.ts";

const require = createRequire(import.meta.url);
function load(path: string, boundaries: Record<string, any> = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} as any };
  new Function("require", "module", "exports", code)((id: string) => {
    if (id.endsWith("/edit-component") || id.endsWith("/view-component")) return {};
    return boundaries[id] ?? require(id);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const file = load("lib/utils/file.ts");
const fields = Object.fromEntries(["string", "number", "boolean", "uuid", "select", "reference", "date", "image", "file"].map((type) => [
  type, load(`fields/core/${type}/index.${["date"].includes(type) ? "ts" : "tsx"}`, {
    "@/lib/utils/file": file,
    "@/lib/github-image": {},
    "@/lib/schema": {},
  }),
]));
const registry = {
  schemas: Object.fromEntries(Object.entries(fields).map(([type, field]) => [type, field.schema])),
  defaultValues: Object.fromEntries(Object.entries(fields).map(([type, field]) => [type, field.defaultValue])),
  fieldTypes: new Set([...Object.keys(fields), "object", "block"]),
};
const { generateZodSchema } = load("lib/schema.ts", { "@/fields/registry": registry });
const configSchema = load("lib/config-schema.ts", { "@/fields/registry": registry, "./collection-sort": sort, "./collection-order": reorder });
const { parseAndValidateConfig } = load("lib/config.ts", {
  "@/lib/config-schema": configSchema, "@/lib/utils/file": file,
});

test("configuration diagnostics preserve required, type, union, and unknown-key locations", () => {
  const valid = "content:\n  - name: page\n    type: file\n    path: content/page.json\n    fields:\n      - name: title\n        type: string\n";
  assert.deepEqual(parseAndValidateConfig(valid).validationErrors, []);
  for (const [source, message] of [
    ["actions:\n  - label: Publish\n    workflow: publish.yml\n", "'name' is required."],
    ["actions:\n  - name: 12\n    label: Publish\n    workflow: publish.yml\n", "'name' must be a string."],
    ["media:\n  - name: images\n    input: 123\n    output: /images\n", "'input' is required."],
    ["components:\n  bad key:\n    type: string\n", "Component key must be alphanumeric with dashes and underscores."],
  ]) {
    const result = parseAndValidateConfig(source);
    assert.equal(result.parseErrors.length, 0);
    assert.ok(result.validationErrors.some((issue: any) => issue.message === message), JSON.stringify(result.validationErrors));
    assert.ok(result.validationErrors.every((issue: any) => issue.to > issue.from));
  }
  const source = `${valid}unexpected: true\n`;
  const warnings = parseAndValidateConfig(source).validationErrors;
  assert.ok(warnings.some((issue: any) => issue.severity === "warning" && source.slice(issue.from, issue.to) === "unexpected"));
});

test("real field schemas retain coercion, UUID format, selection limits, and media rejection", () => {
  assert.equal(fields.number.schema({ required: true }).parse("0"), 0);
  assert.equal(fields.boolean.schema({}).parse(false), false);
  assert.equal(fields.uuid.schema({ required: true }).safeParse("11111111-1111-1111-1111-111111111111").success, true);
  assert.equal(fields.uuid.schema({ required: true }).safeParse("not-a-uuid").success, false);
  const selection = fields.select.schema({ required: true, options: { multiple: true, values: ["a", "b"], max: 1 } });
  assert.deepEqual(selection.parse(["a"]), ["a"]);
  assert.equal(selection.safeParse(["a", "b"]).success, false);
  assert.equal(selection.safeParse(["missing"]).success, false);
  const references = fields.reference.schema({ required: true, options: { multiple: true, max: 1 } });
  assert.deepEqual(references.parse([{ value: "entry" }]), ["entry"]);
  assert.equal(references.safeParse([]).success, false);
  assert.equal(fields.date.schema({ required: true }).safeParse("2026-02-30").success, false);
  for (const type of ["file", "image"]) {
    const schema = fields[type].schema({ required: true, options: { multiple: true, unique: true, extensions: ["png"] } }, { media: [{ input: "images", extensions: ["png"] }] });
    assert.deepEqual(schema.parse(["images/a.png"]), ["images/a.png"]);
    for (const invalid of [[], ["images/a.png", "images/a.png"], ["images/a.txt"], ["other/a.png"]]) {
      assert.equal(schema.safeParse(invalid).success, false, `${type}: ${JSON.stringify(invalid)}`);
    }
  }
});

test("entry resolver exposes nested and union validation failures and returns parsed values", async () => {
  const schema = generateZodSchema([
    { name: "meta", type: "object", required: true, fields: [{ name: "title", type: "string", required: true }] },
    { name: "count", type: "number", required: true, options: { min: 0 } },
    { name: "items", type: "string", list: { max: 1 } },
  ]);
  const resolve = zodResolver(schema);
  const options = { fields: {}, shouldUseNativeValidation: false, criteriaMode: "all" as const };
  const invalid = await resolve({ meta: { title: "" }, count: "bad", items: ["a", "b"] }, undefined, options);
  assert.equal((invalid.errors.meta as any).title.message, "This field is required");
  assert.ok(invalid.errors.count?.message);
  assert.ok(invalid.errors.items?.message);
  const valid = await resolve({ meta: { title: "Kept" }, count: "0", items: ["a"] }, undefined, options);
  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.values, { meta: { title: "Kept" }, count: 0, items: ["a"] });
});

test("oversized constrained entry lists fail before validating every invalid item", () => {
  const schema = generateZodSchema([{ name: "items", type: "string", list: { max: 1 } }]);
  const result = schema.safeParse({ items: Array(20).fill(42) });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue: any) => ({ code: issue.code, path: issue.path })), [
    { code: "too_big", path: ["items"] },
  ]);
});
