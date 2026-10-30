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

function fixture(mediaOperations?: { delete?: boolean; rename?: boolean }) {
  const assets = new Map([[originalPath, "existing-pdf-bytes"]]);
  const savedReference = originalPath;
  let writes = 0;
  let pendingTree: { path: string; sha: string }[] = [];
  const fileUtils = load("lib/utils/file.ts");
  const errors = load("lib/api-error.ts");
  const config = { object: { media: [{ name: "catalogues", input: "media", extensions: ["pdf"], operations: mediaOperations }] } };
  const external = {
    "@/lib/session-server": { requireApiUserSession: async () => ({ user: { id: "fixture", email: "fixture@example.invalid" } }) },
    "@/lib/token": { getToken: async () => ({ token: "fixture-token" }) },
    "@/lib/config-store": { getConfig: async () => config },
    "@/lib/github-cache-file": { updateFileCache: async () => {}, getBranchHeadSha: async () => "fixture-head", setBranchHeadSha: async () => {} },
    "@/lib/utils/octokit": { createOctokitInstance: () => ({ rest: {
      repos: { deleteFile: async ({ path }: { path: string }) => {
        writes++;
        assets.delete(path);
        return { data: { commit: { sha: "fixture-deleted" }, content: null } };
      } },
      git: {
        getTree: async () => ({ data: { tree: [...assets.keys()].map(path => ({ path, type: "blob", mode: "100644", sha: "fixture-pdf" })) } }),
        createTree: async ({ tree }: { tree: typeof pendingTree }) => { pendingTree = tree; return { data: { sha: "fixture-tree" } }; },
        createCommit: async () => ({ data: { sha: "fixture-renamed" } }),
        updateRef: async () => {
          writes++;
          const bytes = assets.get(originalPath)!;
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
    "@/lib/github-media-metadata": {},
    "@/fields/registry": {},
    "@/lib/config": {},
    "@/lib/serialization": {},
    "@/lib/config-revision": {},
    "@/lib/authz-shared": {},
    "@/lib/duplicate-entry": {},
  };
  const files = load("app/api/[owner]/[repo]/[branch]/files/[path]/route.ts", mocks);
  const rename = load("app/api/[owner]/[repo]/[branch]/files/[path]/rename/route.ts", mocks);
  const context = { params: Promise.resolve({ owner: "fixture", repo: "catalogue", branch: "main", path: originalPath }) };
  const request = (method: "DELETE" | "POST") => {
    const url = new URL(`https://cms.test/api/fixture/catalogue/main/files/${encodeURIComponent(originalPath)}${method === "POST" ? "/rename" : ""}?type=media&name=catalogues&sha=fixture-pdf`);
    const req = new Request(url, {
      method, headers: { host: "cms.test", origin: "https://cms.test" },
      ...(method === "POST" ? { body: JSON.stringify({ type: "media", name: "catalogues", sha: "fixture-pdf", newPath: replacementPath }) } : {}),
    });
    Object.defineProperty(req, "nextUrl", { value: url });
    return req;
  };
  return {
    delete: () => files.DELETE(request("DELETE"), context),
    rename: () => rename.POST(request("POST"), context),
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
