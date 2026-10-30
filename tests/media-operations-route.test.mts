import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as limits from "../lib/upload-limits.ts";
import * as metadata from "../lib/media-metadata.ts";
import * as operations from "../lib/operations.ts";

const require = createRequire(import.meta.url);
const originalPath = "media/catalogue-october.pdf";
const replacementPath = "media/catalogue-renamed.pdf";

function load(file: string, mocks: Record<string, any> = {}) {
  const loaded = { exports: {} as any };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", compiled)((id: string) => id in mocks ? mocks[id] : require(id), loaded, loaded.exports);
  return loaded.exports;
}

function fixture(mediaOperations?: { delete?: boolean; rename?: boolean }, options: {
  path?: string; newPath?: string; name?: string; type?: "content" | "media";
  media?: Record<string, unknown>[] | false; metadata?: boolean; noMedia?: boolean;
} = {}) {
  const sourcePath = options.path ?? originalPath;
  const newPath = options.newPath ?? replacementPath;
  const type = options.type ?? "media";
  const name = options.name ?? "catalogues";
  const assets = new Map([[sourcePath, "existing-pdf-bytes"]]);
  const savedReference = sourcePath;
  let writes = 0;
  const mutations: string[] = [];
  const configReads: Record<string, unknown>[] = [];
  let pendingTree: { path: string; sha: string }[] = [];
  const fileUtils = load("lib/utils/file.ts");
  const errors = load("lib/api-error.ts");
  const config = { sha: "fixture-config", object: {
    ...(options.noMedia ? {} : { media: options.media ?? [{ name: "catalogues", input: "media", extensions: ["pdf"], operations: mediaOperations }] }),
    content: [{ name: "content-alias", type: "collection", path: "", extension: "pdf" }],
    ...(options.metadata ? { mediaMetadata: "data/media.json" } : {}),
  } };
  const external = {
    "@/lib/session-server": { requireApiUserSession: async () => ({ user: { id: "fixture", email: "fixture@example.invalid" } }) },
    "@/lib/token": { getToken: async () => ({ token: "fixture-token" }) },
    "@/lib/config-store": { getConfig: async (_owner: string, _repo: string, _branch: string, readOptions: Record<string, unknown>) => { configReads.push(readOptions); return config; } },
    "@/lib/github-cache-file": { updateFileCache: async () => {}, getBranchHeadSha: async () => "fixture-head", setBranchHeadSha: async () => {} },
    "@/lib/utils/octokit": { createOctokitInstance: () => ({ rest: {
      repos: { deleteFile: async ({ path }: { path: string }) => {
        mutations.push("deleteFile");
        writes++;
        assets.delete(path);
        return { data: { commit: { sha: "fixture-deleted" }, content: null } };
      } },
      git: {
        getTree: async () => ({ data: { tree: [...assets.keys()].map(path => ({ path, type: "blob", mode: "100644", sha: "fixture-pdf" })) } }),
        createTree: async ({ tree }: { tree: typeof pendingTree }) => { mutations.push("createTree"); pendingTree = tree; return { data: { sha: "fixture-tree" } }; },
        createCommit: async () => { mutations.push("createCommit"); return { data: { sha: "fixture-renamed" } }; },
        updateRef: async () => {
          mutations.push("updateRef");
          writes++;
          const bytes = assets.get(sourcePath)!;
          assets.clear();
          for (const item of pendingTree) assets.set(item.path, bytes);
        },
      },
    } }) },
  };
  const mocks = {
    ...external,
    "@/lib/upload-limits": limits,
    "@/lib/media-metadata": metadata,
    "@/lib/operations": operations,
    "@/lib/api-error": errors,
    "@/lib/utils/file": fileUtils,
    "@/lib/schema": load("lib/schema.ts", { "@/fields/registry": {} }),
    "@/lib/commit-message": load("lib/commit-message.ts", { "@/lib/utils/file": fileUtils }),
    "@/lib/github-media-metadata": { mutateMediaMetadata: async (_context: unknown, mutation: { action: string; path: string; newPath?: string }) => {
      mutations.push(`metadata:${mutation.action}`);
      writes++;
      const bytes = assets.get(mutation.path)!;
      assets.delete(mutation.path);
      if (mutation.newPath) assets.set(mutation.newPath, bytes);
      return { commitSha: "fixture-metadata-commit" };
    } },
    "@/fields/registry": {},
    "@/lib/config": {},
    "@/lib/serialization": {},
    "@/lib/config-revision": load("lib/config-revision.ts", { "@/lib/api-error": errors }),
    "@/lib/authz-shared": {},
    "@/lib/duplicate-entry": {},
  };
  const files = load("app/api/[owner]/[repo]/[branch]/files/[path]/route.ts", mocks);
  const rename = load("app/api/[owner]/[repo]/[branch]/files/[path]/rename/route.ts", mocks);
  const context = { params: Promise.resolve({ owner: "fixture", repo: "catalogue", branch: "main", path: sourcePath }) };
  const request = (method: "DELETE" | "POST") => {
    const url = new URL(`https://cms.test/api/fixture/catalogue/main/files/${encodeURIComponent(sourcePath)}${method === "POST" ? "/rename" : ""}?type=${type}&name=${name}&sha=fixture-pdf`);
    const req = new Request(url, {
      method, headers: { host: "cms.test", origin: "https://cms.test" },
      ...(method === "POST" ? { body: JSON.stringify({ type, name, sha: "fixture-pdf", newPath, configSha: config.sha }) } : {}),
    });
    Object.defineProperty(req, "nextUrl", { value: url });
    return req;
  };
  return {
    delete: () => files.DELETE(request("DELETE"), context),
    rename: () => rename.POST(request("POST"), context),
    mutations,
    configReads,
    snapshot: () => ({ writes, paths: [...assets.keys()], savedReference, savedReferenceExists: assets.has(savedReference) }),
  };
}

test("legacy media Delete still removes the physical file immediately", async () => {
  const f = fixture();
  assert.equal((await f.delete()).status, 200);
  assert.deepEqual(f.snapshot(), { writes: 1, paths: [], savedReference: originalPath, savedReferenceExists: false });
});

test("protected catalogue Delete is forbidden before removing a saved reference's file", async () => {
  const f = fixture({ delete: false, rename: false });
  const response = await f.delete();
  assert.deepEqual({ status: response.status, ...f.snapshot() }, {
    status: 403, writes: 0, paths: [originalPath], savedReference: originalPath, savedReferenceExists: true,
  });
});

test("legacy media Rename still moves the physical file immediately", async () => {
  const f = fixture();
  assert.equal((await f.rename()).status, 200);
  assert.deepEqual(f.snapshot(), { writes: 1, paths: [replacementPath], savedReference: originalPath, savedReferenceExists: false });
});

test("protected catalogue Rename is forbidden before moving a saved reference's file", async () => {
  const f = fixture({ delete: false, rename: false });
  const response = await f.rename();
  assert.deepEqual({ status: response.status, ...f.snapshot() }, {
    status: 403, writes: 0, paths: [originalPath], savedReference: originalPath, savedReferenceExists: true,
  });
});

test("delete and rename opt-ins remain independent", async () => {
  for (const [flags, method] of [
    [{ delete: false }, "delete"], [{ rename: false }, "rename"],
  ] as const) {
    const blocked = fixture(flags);
    assert.equal((await blocked[method]()).status, 403);
    assert.deepEqual(blocked.mutations, []);
    const allowed = fixture(flags);
    const otherMethod = method === "delete" ? "rename" : "delete";
    assert.equal((await allowed[otherMethod]()).status, 200);
    assert.equal(allowed.snapshot().writes, 1);
  }
});

test("protected paths cannot be deleted or renamed through an unrestricted media or content alias", async () => {
  const media = [
    { name: "catalogues", input: "media", operations: { delete: false, rename: false } },
    { name: "all", input: "", extensions: ["pdf"] },
  ];
  for (const alias of [{ type: "media", name: "all" }, { type: "content", name: "content-alias" }] as const) {
    for (const method of ["delete", "rename"] as const) {
      const f = fixture(undefined, { ...alias, media });
      assert.equal((await f[method]()).status, 403);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.snapshot().savedReferenceExists, true);
    }
  }
});

test("rename protects the destination and allows a sibling-prefix directory", async () => {
  const media = [
    { name: "catalogues", input: "media", operations: { delete: false, rename: false } },
    { name: "all", input: "", extensions: ["pdf"] },
  ];
  for (const alias of [{ type: "media", name: "all" }, { type: "content", name: "content-alias" }] as const) {
    const destination = fixture(undefined, { ...alias, media, path: "media-other/old.pdf", newPath: "media/new.pdf" });
    assert.equal((await destination.rename()).status, 403);
    assert.deepEqual(destination.mutations, []);
    const sibling = fixture(undefined, { ...alias, media, path: "media-other/old.pdf", newPath: "media-other/new.pdf" });
    assert.equal((await sibling.rename()).status, 200);
    assert.equal(sibling.snapshot().writes, 1);
  }
});

test("metadata-enabled media denial performs neither metadata nor GitHub mutations", async () => {
  for (const method of ["delete", "rename"] as const) {
    const blocked = fixture({ delete: false, rename: false }, { metadata: true });
    assert.equal((await blocked[method]()).status, 403);
    assert.deepEqual(blocked.mutations, []);
    const allowed = fixture(undefined, { metadata: true });
    assert.equal((await allowed[method]()).status, 200);
    assert.deepEqual(allowed.mutations, [`metadata:${method}`]);
  }
});

test("disabled or absent media preserves normal content operations", async () => {
  for (const options of [{ noMedia: true }, { media: false }] as const) {
    for (const method of ["delete", "rename"] as const) {
      const f = fixture(undefined, { ...options, type: "content", name: "content-alias" });
      assert.equal((await f[method]()).status, 200);
      assert.equal(f.snapshot().writes, 1);
    }
  }
});

test("Delete checks the current configuration synchronously before a destructive write", async () => {
  const f = fixture();
  assert.equal((await f.delete()).status, 200);
  assert.equal(f.configReads.length, 1);
  assert.equal(f.configReads[0].sync, true);
  assert.equal(f.configReads[0].ttlMs, 0);
});
