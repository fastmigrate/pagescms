import assert from "node:assert/strict";
import test from "node:test";
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

test("content saves and save-time renames reject old or missing configuration before GitHub writes", async () => {
  let writes = 0; let checks = 0;
  const load = loadFixture({
    "@/lib/session-server": { requireApiUserSession: async () => ({ user: { id: "u", githubUsername: "editor" } }) },
    "@/lib/token": { getToken: async () => ({ token: "token" }) },
    "@/lib/config-store": { getConfig: async (_owner: string, _repo: string, _branch: string, options: any) => {
      assert.equal(options.sync, true); assert.equal(options.ttlMs, 0); checks++;
      return { sha: "current", object: {} };
    } },
    "@/fields/registry": {}, "@/lib/config": {}, "@/lib/schema": {}, "@/lib/serialization": {},
    "@/lib/operations": { isContentOperationAllowed: () => true },
    "@/lib/utils/file": { normalizePath: (path: string) => path },
    "@/lib/github-cache-file": {}, "@/lib/commit-message": {}, "@/lib/duplicate-entry": {},
    "@/lib/github-media-metadata": {},
    "@/lib/utils/octokit": { createOctokitInstance: () => { writes++; throw new Error("Unexpected GitHub write"); } },
  });
  for (const path of ["files/[path]/route.ts", "files/[path]/rename/route.ts"]) {
    const { POST } = load(`app/api/[owner]/[repo]/[branch]/${path}`);
    for (const configSha of [undefined, "old"]) {
      const request = new Request("https://cms.test/api/o/r/main/files/content%2Fpage.json", {
        method: "POST", headers: { host: "cms.test", origin: "https://cms.test" },
        body: JSON.stringify({ type: "content", name: "pages", content: { title: "Draft" }, newPath: "content/new.json", configSha }),
      });
      const response = await POST(request, { params: Promise.resolve(params) });
      assert.equal(response.status, 409);
      assert.match((await response.json()).message, /Configuration changed/);
    }
  }
  assert.equal(checks, 4); assert.equal(writes, 0);
});

test("content reads reject a configuration mismatch before fetching the entry", async () => {
  let reads = 0;
  const load = loadFixture({
    "@/lib/session-server": { requireApiUserSession: async () => ({ user: { id: "u" } }) },
    "@/lib/token": { getToken: async () => ({ token: "token" }) },
    "@/lib/config-store": { getConfig: async () => ({ sha: "current", object: {} }) },
    "@/lib/utils/file": { normalizePath: (path: string) => path },
    "@/lib/schema": {}, "@/fields/registry": {}, "@/lib/serialization": {},
    "@/lib/utils/octokit": { createOctokitInstance: () => { reads++; throw new Error("Unexpected entry read"); } },
  });
  const { GET } = load("app/api/[owner]/[repo]/[branch]/entries/[path]/route.ts");
  const response = await GET({ nextUrl: new URL("https://cms.test?name=pages&configSha=old") }, { params: Promise.resolve(params) });
  assert.equal(response.status, 409); assert.equal(reads, 0);
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
