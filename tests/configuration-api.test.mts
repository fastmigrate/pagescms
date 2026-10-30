import assert from "node:assert/strict";
import test from "node:test";
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
function loadFixture(mocks: Record<string, any>) {
  const modules = new Map<string, any>();
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path).exports;
    const mod = { exports: {} };
    modules.set(path, mod);
    const require = (id: string): any => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (!id.startsWith("@/") && !id.startsWith(".")) return nativeRequire(id);
      const base = id.startsWith("@/") ? resolve(root, id.slice(2)) : resolve(dirname(path), id);
      const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!file) throw new Error(`Missing test dependency ${id}`);
      return load(file);
    };
    new Function("require", "module", "exports", ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText)(require, mod, mod.exports);
    return mod.exports;
  }
  return (path: string) => load(resolve(root, path));
}
const params = { owner: "o", repo: "r", branch: "main", path: "content/page.json" };

test("configuration API uses actual repository authorization and works with cache disabled", async () => {
  let signedIn = true; let permission = true; let checks = 0;
  let checkError: Error | null = null;
  let config: any = { owner: "o", repo: "r", branch: "main", sha: "new", object: { settings: { cache: false } } };
  const load = loadFixture({
    "@/lib/session-server": { requireApiUserSession: async () => signedIn ? { user: { id: "u" } } : { response: Response.json({}, { status: 401 }) } },
    "@/lib/token": { getToken: async () => ({ token: "token", source: "user" }) },
    "@/lib/github-account": { getGithubId: async () => 123 },
    "@/db": { db: { query: { cachePermissionTable: { findFirst: async () => null } }, insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }) } },
    "@/db/schema": { cachePermissionTable: {} },
    "@/lib/utils/octokit": { createOctokitInstance: () => ({ rest: { repos: { get: async () => ({ status: permission ? 200 : 403 }) } } }) },
    "@/lib/config-store": { getConfig: async (_owner: string, _repo: string, _branch: string, options: any) => {
      assert.equal(options.sync, true); assert.equal(options.ttlMs, 0); checks++;
      if (checkError) throw checkError;
      return config;
    } },
  });
  const { GET } = load("app/api/[owner]/[repo]/[branch]/configuration/route.ts");
  const context = { params: Promise.resolve(params) };
  const response = await GET(new Request("https://cms.test"), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await response.json()).data, config);
  config = null;
  const missing = await GET(new Request("https://cms.test"), context);
  assert.equal(missing.status, 200);
  assert.equal(missing.headers.get("Cache-Control"), "no-store");
  assert.equal((await missing.json()).data, null);
  checkError = Object.assign(new Error("Unrelated upstream not found"), { status: 404 });
  assert.equal((await GET(new Request("https://cms.test"), context)).status, 404);
  checkError = new Error("Transient upstream failure");
  assert.equal((await GET(new Request("https://cms.test"), context)).status, 500);
  checkError = null;
  permission = false;
  assert.equal((await GET(new Request("https://cms.test"), context)).status, 403);
  signedIn = false;
  assert.equal((await GET(new Request("https://cms.test"), context)).status, 401);
  assert.equal(checks, 4);
});

test("content saves and save-time renames bind configuration to the immutable writer snapshot", async () => {
  const f = cmsGitFixture({ content: [{ name: "pages", type: "collection", path: "content", filename: "{primary}.json", fields: [{ name: "title", type: "string" }] }] }, { "content/page.json": { title: "Saved" } });
  for (const configSha of [undefined, "old"]) {
    for (const response of [await f.save("content/page.json", { title: "Draft" }, { name: "pages", configSha }), await f.rename("content/page.json", "content/new.json", { type: "content", name: "pages", configSha })]) {
      assert.equal(response.status, 409); assert.match((await response.json()).message, /Configuration changed/);
    }
  }
  assert.deepEqual(f.mutations, []);
});

test("content reads reject a configuration mismatch before fetching the entry", async () => {
  let reads = 0;
  let present = true;
  const load = loadFixture({
    "@/lib/session-server": { requireApiUserSession: async () => ({ user: { id: "u" } }) },
    "@/lib/token": { getToken: async () => ({ token: "token" }) },
    "@/lib/config-store": { getConfig: async () => present ? ({ sha: "current", object: {} }) : null },
    "@/lib/utils/file": { normalizePath: (path: string) => path },
    "@/lib/schema": {}, "@/fields/registry": {}, "@/lib/serialization": {},
    "@/lib/utils/octokit": { createOctokitInstance: () => { reads++; throw new Error("Unexpected entry read"); } },
  });
  const { GET } = load("app/api/[owner]/[repo]/[branch]/entries/[path]/route.ts");
  const response = await GET({ nextUrl: new URL("https://cms.test?name=pages&configSha=old") }, { params: Promise.resolve(params) });
  assert.equal(response.status, 409); assert.equal(reads, 0);
  present = false;
  const missing = await GET({ nextUrl: new URL("https://cms.test?name=pages&configSha=old") }, { params: Promise.resolve(params) });
  assert.equal(missing.status, 409); assert.equal(reads, 0);
  const unversioned = await GET({ nextUrl: new URL("https://cms.test?name=pages") }, { params: Promise.resolve(params) });
  assert.equal(unversioned.status, 404); assert.equal(reads, 0);
});

test("branch creation and deletion clear parsed configuration, file data and metadata", async () => {
  const cleared: string[] = [];
  const load = loadFixture({
    "@/db": { db: { delete: (table: string) => ({ where: async () => { cleared.push(table); } }) } },
    "@/db/schema": { configTable: "config" },
    "@/lib/github-cache-file": { clearFileCache: async () => { cleared.push("files"); } },
    "@/lib/github-cache-meta": { deleteCacheFileMeta: async () => { cleared.push("meta"); } },
  });
  const { handleInstallationWebhookEvent } = load("lib/github-webhook-installation.ts");
  for (const event of ["create", "delete"]) {
    assert.equal(await handleInstallationWebhookEvent(event, { ref_type: "branch", ref: "main", repository: { name: "r", owner: { login: "o" } } }), true);
  }
  assert.deepEqual(cleared, ["config", "files", "meta", "config", "files", "meta"]);
  assert.equal(await handleInstallationWebhookEvent("delete", { ref_type: "tag" }), false);
});
