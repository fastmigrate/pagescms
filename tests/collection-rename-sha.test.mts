import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { productionLoader } from "./helpers/cms-git-fixture.mts";

const text = readFileSync(new URL("../components/collection/collection.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("collection.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("Add children passes a nested row's loaded SHA through the production Rename callback", async () => {
  let callback: ts.ArrowFunction | undefined;
  let caller: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleConfirmRenameNode" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0] as ts.ArrowFunction;
    if (ts.isCallExpression(node) && node.expression.getText(source) === "handleConfirmRenameNode") caller = node;
    ts.forEachChild(node, visit);
  };
  visit(source); assert(callback); assert(caller);
  const config = { owner: "fixture", repo: "private", branch: "main", sha: "loaded-config" };
  const nested = { path: "content/parent/nested.json", sha: "loaded-nested-sha" };
  const row = { original: nested, depth: 1 };
  const schema = { extension: "json", view: { node: { filename: "index.json" } } };
  const requests: { url: string; body: any }[] = [];
  const routes: string[] = [];
  let pending: Promise<any> | undefined;
  const { requireApiSuccess } = productionLoader()("lib/api-client.ts");
  const dependencies = {
    config, name: "pages", data: [{ path: "content/parent.json", sha: "parent-sha", subRows: [nested] }],
    normalizePath: (value: string) => value,
    fetch: async (url: string, options: any) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return Response.json({ status: "success", message: "Renamed" });
    },
    requireApiSuccess, router: { push: (path: string) => routes.push(path) },
    toast: { promise: (promise: Promise<any>) => { pending = promise; } },
  };
  const compiled = ts.transpileModule(`const callback = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handleConfirmRenameNode = new Function(...Object.keys(dependencies), `${compiled}\nreturn callback;`)(...Object.values(dependencies));
  new Function("handleConfirmRenameNode", "row", "schema", `${caller.getText(source)};`)(handleConfirmRenameNode, row, schema);
  assert(pending); await pending;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.sha, "loaded-nested-sha");
  assert.equal(requests[0].body.newPath, "content/parent/nested/index.json");
  assert.equal(requests[0].body.configSha, "loaded-config");
  assert(requests[0].url.includes(encodeURIComponent(nested.path)));
  assert.equal(routes.length, 0);
});
