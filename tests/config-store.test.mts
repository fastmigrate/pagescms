import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function fixture() {
  let cached: any = { owner: "o", repo: "r", branch: "main", sha: "old", version: "3.0", object: JSON.stringify({ fields: ["title"] }), lastCheckedAt: new Date(0) };
  let reads = 0;
  let remote: any = { sha: "new", fields: ["title", "seoTitle"] };
  let failure: any;
  const db = { query: { configTable: { findFirst: async () => cached } },
    update: () => ({ set: (values: any) => ({ where: async () => { cached = { ...cached, ...values }; } }) }),
    insert: () => ({ values: (values: any) => ({ onConflictDoUpdate: async () => { cached = values; } }) }),
    delete: () => ({ where: async () => { cached = null; } }),
  };
  const mocks: any = {
    "@/db": { db }, "@/db/schema": { configTable: {} }, "drizzle-orm": { and: () => {}, eq: () => {}, sql: () => {} },
    "@/lib/config": { configVersion: "3.0", parseConfig: (source: string) => ({ errors: [], document: { toJSON: () => JSON.parse(source) } }), normalizeConfig: (value: any) => value },
    "@/lib/utils/octokit": { createOctokitInstance: () => ({ rest: { repos: { getContent: async () => {
      reads++; if (failure) throw failure;
      return { data: { type: "file", sha: remote.sha, content: Buffer.from(JSON.stringify(remote)).toString("base64") } };
    } } } }) },
  };
  const mod: any = { exports: {} };
  const source = readFileSync(new URL("../lib/config-store.ts", import.meta.url), "utf8");
  new Function("require", "module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(
    (id: string) => mocks[id] ?? require(id), mod, mod.exports,
  );
  return { get: (options: any = {}) => mod.exports.getConfig("o", "r", "main", { getToken: async () => "token", ...options }),
    reads: () => reads, cached: () => cached, fail: (error: any) => { failure = error; }, remote: (value: any) => { remote = value; } };
}
test("ordinary authenticated reads recover a stale branch-name cache without a webhook", async () => {
  const f = fixture();
  assert.equal((await f.get()).sha, "new");
  assert.equal(f.reads(), 1);
  assert.deepEqual(JSON.parse(f.cached().object).fields, ["title", "seoTitle"]);
});
test("recent reads reuse the verified configuration and a forced load checks GitHub", async () => {
  const f = fixture();
  await f.get({ sync: true, ttlMs: 0 });
  await f.get();
  assert.equal(f.reads(), 1);
  f.remote({ sha: "next", fields: ["title", "seoTitle", "description"] });
  assert.equal((await f.get({ sync: true, ttlMs: 0 })).sha, "next");
  assert.equal(f.reads(), 2);
});
test("synchronous GitHub failures preserve the cache and report the failure", async () => {
  const f = fixture(); f.fail(new Error("GitHub unavailable"));
  await assert.rejects(f.get({ sync: true, ttlMs: 0 }), /GitHub unavailable/);
  assert.equal(f.cached().sha, "old");
});
test("deleted configuration removes the old cached editor schema", async () => {
  const f = fixture(); f.fail(Object.assign(new Error("Not Found"), { status: 404, response: { data: { message: "Not Found" } } }));
  assert.equal(await f.get({ sync: true, ttlMs: 0 }), null);
  assert.equal(f.cached(), null);
});
