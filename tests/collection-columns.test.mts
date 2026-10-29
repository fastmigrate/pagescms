import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ts from "typescript";
import { resolveCollectionColumns, selectCollectionSource } from "../lib/collection-columns.ts";

const fields = [{ name: "title", type: "string", label: false as const },
  { name: "meta", type: "object", fields: [{ name: "date", type: "date", options: { format: "dd.MM.yyyy" } }] },
  { name: "event", type: "string" }, { name: "hidden", type: "string", hidden: true }];
const fallback = { name: "when", label: "Date or event", fallback: ["meta.date", "event"] };

test("resolved columns retain legacy defaults, direct false labels, nested fields and filename date", () => {
  assert.deepEqual(resolveCollectionColumns({ fields }).map(column => column.id), ["title", "event"]);
  assert.deepEqual(resolveCollectionColumns({}).map(column => column.label), ["Name"]);
  const columns = resolveCollectionColumns({ fields, filename: "{year}-{month}-{day}-{title}.json", view: { fields: ["title", "meta.date", "date", "missing", "meta", fallback] } });
  assert.deepEqual(columns.map(column => column.id), ["title", "meta.date", "display:when", "date"]);
  assert.equal(columns[0].label, false);
  assert.equal(columns[2].sources[0].field.type, "date");
  assert.deepEqual(columns[2].sources[0].field.options, { format: "dd.MM.yyyy" });
  assert.deepEqual(resolveCollectionColumns({ fields, view: { fields: ["hidden"] } }).map(column => column.id), ["hidden"]);
});

test("fallback selects the first populated value and its field while preserving zero and false", () => {
  const column = resolveCollectionColumns({ fields, view: { fields: [fallback] } })[0];
  for (const blank of [null, undefined, "", " \t\n"]) {
    assert.equal(selectCollectionSource(column, path => path === "meta.date" ? blank : "Autumn")?.source.field.type, "string");
  }
  for (const value of [0, false, "2026-10-29"]) {
    const selected = selectCollectionSource(column, path => path === "meta.date" ? value : "Autumn");
    assert.equal(selected?.value, value);
    assert.equal(selected?.source.field.type, "date");
  }
  assert.equal(selectCollectionSource(column, () => "  "), undefined);
});

test("shared cells select the source renderer and options without rendering absent fallback values", () => {
  const require = createRequire(import.meta.url);
  const loadedModule = { exports: {} as any };
  const code = ts.transpileModule(readFileSync(new URL("../components/collection/collection-cell.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)((name: string) => name === "@/lib/collection-columns"
    ? { selectCollectionSource } : name === "@/fields/registry"
      ? { viewComponents: { date: ({ value, field }: any) => createElement("time", null, `${value} (${field.options.format})`) } } : require(name), loadedModule, loadedModule.exports);
  const column = resolveCollectionColumns({ fields, view: { fields: [fallback] } })[0];
  const render = (date: unknown, event: unknown) => renderToStaticMarkup(createElement(loadedModule.exports.CollectionCell, {
    column, valueAt: (path: string) => path === "meta.date" ? date : event,
  }));
  assert.equal(render("2026-10-29", "Autumn"), "<time>2026-10-29 (dd.MM.yyyy)</time>");
  assert.equal(render("", "Autumn"), "Autumn");
  assert.equal(render(null, 0), "0");
  assert.equal(render(null, false), "false");
  assert.equal(render(" ", "\t"), "");
});
