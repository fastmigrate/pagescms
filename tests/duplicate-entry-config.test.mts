import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as sort from "../lib/collection-sort.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/config-schema.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const loadedModule = { exports: {} as any };
new Function("require", "module", "exports", code)(
  (name: string) => name === "@/fields/registry"
    ? { fieldTypes: new Set(["string", "text", "boolean", "number", "object"]) }
    : name === "./collection-sort"
      ? sort
      : require(name),
  loadedModule,
  loadedModule.exports,
);
const { ConfigSchema } = loadedModule.exports;

const schemaSource = readFileSync(new URL("../lib/schema.ts", import.meta.url), "utf8");
const schemaCode = ts.transpileModule(schemaSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const loadedSchema = { exports: {} as any };
new Function("require", "module", "exports", schemaCode)(
  (name: string) => name === "@/fields/registry"
    ? { defaultValues: {}, schemas: {} }
    : name === "@/types/field"
      ? {}
      : require(name),
  loadedSchema,
  loadedSchema.exports,
);
const { getPrimaryField } = loadedSchema.exports;

const collection = (duplicate: unknown, overrides: Record<string, unknown> = {}) => ({
  name: "jobs",
  label: "Jobs",
  type: "collection",
  path: "content/jobs",
  format: "json",
  filename: "{primary}.json",
  operations: { duplicate },
  view: { primary: "title" },
  fields: [
    { name: "title", type: "string", required: true },
    { name: "draft", type: "boolean", required: false },
  ],
  ...overrides,
});

test("accepts opt-in entry duplication with localized labels", () => {
  const result = ConfigSchema.safeParse({
    content: [collection({
      label: "Duplizieren",
      description: "Gespeicherten Stand kopieren.",
      field: "title",
      fieldLabel: "Neuer Titel",
      button: "Duplizieren",
      draft: true,
    })],
  });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(ConfigSchema.safeParse({ content: [collection(true)] }).success, true);
  assert.equal(ConfigSchema.safeParse({
    content: [collection(true, { format: undefined })],
  }).success, true);
  assert.equal(ConfigSchema.safeParse({ content: [collection(false)] }).success, true);
  assert.equal(ConfigSchema.safeParse({
    content: [collection(true, {
      view: {},
      fields: [{ name: "name", type: "string" }],
    })],
  }).success, true);
  assert.equal(ConfigSchema.safeParse({
    content: [collection(true, {
      view: {},
      fields: [
        {
          name: "items",
          type: "object",
          list: true,
          fields: [{ name: "title", type: "string" }],
        },
        { name: "name", type: "string" },
      ],
    })],
  }).success, true);
});

test("primary inference skips scalar fields nested in object lists", () => {
  assert.equal(getPrimaryField({
    fields: [
      {
        name: "items",
        type: "object",
        list: true,
        fields: [{ name: "title", type: "string" }],
      },
      { name: "name", type: "string" },
    ],
  }), "name");
});

test("rejects unsafe or unsupported duplicate configurations", () => {
  const cases = [
    collection(true, { type: "file" }),
    collection(true, { operations: { create: false, duplicate: true } }),
    collection({ field: "missing" }),
    collection({ field: "draft" }),
    collection({ draft: true }, {
      fields: [{ name: "title", type: "string" }],
    }),
    collection(true, { list: true }),
    collection(true, { list: { collapsible: true } }),
    collection(true, { format: "raw" }),
    collection({ field: "title", unknown: true }),
    collection({ field: "__proto__.polluted" }),
    collection({ field: "title" }, {
      filename: "{fields.slug}.json",
      fields: [
        { name: "title", type: "string" },
        { name: "slug", type: "string" },
      ],
    }),
    collection(true, {
      filename: "news/{primary}.json",
      subfolders: false,
    }),
    collection(true, {
      view: { primary: "constructor" },
      fields: [{ name: "constructor", type: "string" }],
    }),
    collection({ field: "metadata.title" }, {
      filename: "{fields.metadata.title}.json",
      view: { primary: "metadata.title" },
      fields: [{
        name: "metadata",
        type: "object",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "description", type: "string", required: true },
        ],
      }],
    }),
  ];

  for (const value of cases) {
    assert.equal(ConfigSchema.safeParse({ content: [value] }).success, false);
  }
});

test("accepts a nested duplicate field when every object ancestor is required", () => {
  const result = ConfigSchema.safeParse({
    content: [collection({ field: "metadata.title" }, {
      filename: "{fields.metadata.title}.json",
      view: { primary: "metadata.title" },
      fields: [{
        name: "metadata",
        type: "object",
        required: true,
        fields: [
          { name: "title", type: "string", required: true },
          { name: "description", type: "string", required: true },
        ],
      }],
    })],
  });

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});
