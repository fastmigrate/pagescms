import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
export const blobSha = (bytes: Buffer | string) => {
  const content = Buffer.from(bytes);
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
};

export function productionLoader(boundaries: Record<string, any> = {}) {
  const modules = new Map<string, { exports: any }>();
  function load(path: string): any {
    const filename = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`]
      .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    if (!filename) throw new Error(`Missing production module ${path}`);
    if (modules.has(filename)) return modules.get(filename)!.exports;
    const mod = { exports: {} as any };
    modules.set(filename, mod);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", source)((id: string) => {
      if (Object.hasOwn(boundaries, id)) return boundaries[id];
      if (/\/(edit|view)-component$/.test(id)) return {};
      if (id.startsWith("@/")) return load(resolve(root, id.slice(2)));
      if (id.startsWith(".")) return load(resolve(dirname(filename), id));
      return require(id);
    }, mod, mod.exports);
    return mod.exports;
  }
  return (path: string) => load(resolve(root, path));
}

type FileMap = Map<string, { path: string; sha: string; type: string; mode: string; size: number }>;
export function cmsGitFixture(configObject: Record<string, any>, initial: Record<string, unknown> = {}, options: { signedIn?: boolean; allowed?: boolean } = {}) {
  let signedIn = options.signedIn !== false;
  let allowed = options.allowed !== false;
  const blobs = new Map<string, Buffer>();
  const files: FileMap = new Map();
  const trees = new Map<string, FileMap>();
  const commits = new Map<string, { tree: string; parent?: string }>();
  const mutations: { method: string; [key: string]: any }[] = [];
  let head = "initial-head";
  let sequence = 0;
  let truncated = false;
  let brokenBlob: string | undefined;
  let incompleteBlob: string | undefined;
  let cacheFailure = false;
  let omitInline = false;
  let holdUpdates = false;
  const updates: { release: () => void; done: boolean }[] = [];
  const listeners: (() => void)[] = [];
  const notify = () => listeners.splice(0).forEach(listener => listener());
  function setFile(path: string, value: unknown) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    files.set(path, { path, sha, type: "blob", mode: "100644", size: bytes.length });
    return sha;
  }
  setFile(".pages.yml", configObject);
  for (const [path, value] of Object.entries(initial)) setFile(path, value);
  function checkpoint() {
    const tree = `tree-${sequence++}`;
    trees.set(tree, structuredClone(files));
    commits.set(head, { tree });
  }
  checkpoint();
  const octokit = { rest: {
    repos: {
      get: async () => { if (!allowed) throw new Error("Denied repository access"); return { data: {} }; },
      getContent: async ({ path, ref }: any) => {
        const entry = (ref && commits.has(ref) ? trees.get(commits.get(ref)!.tree)! : files).get(path);
        if (!entry) throw Object.assign(new Error("Not Found"), { status: 404 });
        return { data: { ...entry, type: "file", content: omitInline ? "" : blobs.get(entry.sha)!.toString("base64") } };
      },
      createOrUpdateFileContents: async (input: any) => {
        mutations.push({ method: "createOrUpdateFileContents", ...input });
        setFile(input.path, Buffer.from(input.content, "base64"));
        head = `external-${sequence++}`; checkpoint();
        return { data: { content: { ...files.get(input.path), type: "file", name: input.path.split("/").pop() }, commit: { sha: head } } };
      },
    },
    git: {
      getRef: async () => ({ data: { object: { sha: head } } }),
      getCommit: async ({ commit_sha }: any) => ({ data: { tree: { sha: commits.get(commit_sha)!.tree } } }),
      getTree: async ({ tree_sha }: any) => ({ data: { tree: [...trees.get(tree_sha)!.values()], truncated } }),
      getBlob: async ({ file_sha }: any) => {
        if (brokenBlob === file_sha) throw Object.assign(new Error("Injected blob read failure"), { status: 502 });
        const bytes = blobs.get(file_sha)!;
        return { data: { content: bytes.toString("base64"), size: bytes.length + (incompleteBlob === file_sha ? 1 : 0), encoding: "base64" } };
      },
      createBlob: async ({ content, encoding }: any) => {
        const bytes = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
        const sha = blobSha(bytes);
        mutations.push({ method: "createBlob", sha, content: bytes.toString("utf8") });
        blobs.set(sha, bytes);
        return { data: { sha } };
      },
      createTree: async ({ base_tree, tree }: any) => {
        const next = structuredClone(trees.get(base_tree)!);
        for (const change of tree) {
          if (change.sha == null) next.delete(change.path);
          else next.set(change.path, { ...change, size: blobs.get(change.sha)!.length });
        }
        const sha = `tree-${sequence++}`;
        trees.set(sha, next);
        mutations.push({ method: "createTree", base_tree, tree });
        return { data: { sha } };
      },
      createCommit: async ({ tree, parents, message, committer }: any) => {
        assert.equal(parents.length, 1);
        const sha = `head-${sequence++}`;
        commits.set(sha, { tree, parent: parents[0] });
        mutations.push({ method: "createCommit", sha, parents, message, committer });
        return { data: { sha } };
      },
      updateRef: async ({ sha, force }: any) => {
        assert.equal(force, false);
        mutations.push({ method: "updateRef", sha });
        if (holdUpdates) await new Promise<void>(release => { updates.push({ release, done: false }); notify(); });
        if (commits.get(sha)!.parent !== head) throw Object.assign(new Error("Non fast forward"), { status: 422 });
        head = sha;
        files.clear();
        for (const [path, entry] of trees.get(commits.get(sha)!.tree)!) files.set(path, entry);
      },
    },
  } };
  const persistence = async () => { if (cacheFailure) throw new Error("Injected cache failure"); };
  const load = productionLoader({
    "@octokit/app": {},
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth": { auth: { api: { getSession: async () => signedIn ? { user: { id: "fixture", email: "fixture@example.invalid", name: "Fixture", githubUsername: "fixture" } } : null } } },
    "@/lib/github-account": { getGithubAccount: async () => ({ accessToken: "fixture-token" }) },
    "@/db": { db: { query: { collaboratorTable: { findFirst: async () => null } } } },
    "@/lib/crypto": {},
    "@/lib/github-cache-file": { updateFileCache: persistence, clearFileCache: persistence, setBranchHeadSha: persistence },
    "@/lib/github-cache-folders": { getFolderPathsForChanges: (paths: string[]) => paths, invalidateFolderScopes: persistence },
    "@/lib/config-store": { getConfig: async () => ({ sha: files.get(".pages.yml")!.sha, object: load("lib/config.ts").normalizeConfig(JSON.parse(blobs.get(files.get(".pages.yml")!.sha)!.toString())) }), updateConfig: persistence },
    "@/lib/utils/octokit": { createOctokitInstance: () => octokit },
  });
  const fileRoute = load("app/api/[owner]/[repo]/[branch]/files/[path]/route.ts");
  const renameRoute = load("app/api/[owner]/[repo]/[branch]/files/[path]/rename/route.ts");
  const ref = { owner: "fixture", repo: "private", branch: "main" };
  function request(path: string, method: string, data: any, origin = "https://cms.test") {
    const url = new URL(`https://cms.test/api/fixture/private/main/files/${encodeURIComponent(path)}`);
    if (method === "DELETE") for (const [key, value] of Object.entries(data)) if (value != null) url.searchParams.set(key, String(value));
    const req = new Request(url, { method, headers: { host: "cms.test", origin, "content-type": "application/json" }, ...(method !== "DELETE" ? { body: JSON.stringify(data) } : {}) });
    Object.defineProperty(req, "nextUrl", { value: url });
    return req;
  }
  const context = (path: string) => ({ params: Promise.resolve({ ...ref, path }) });
  return {
    load, files, blobs, mutations, setFile,
    get sha() { return files.get(".pages.yml")!.sha; },
    get head() { return head; },
    text: (path: string) => blobs.get(files.get(path)!.sha)!.toString("utf8"),
    json: (path: string) => JSON.parse(blobs.get(files.get(path)!.sha)!.toString("utf8")),
    published: () => mutations.filter(item => item.method === "updateRef" && item.sha === head).length,
    set signedIn(value: boolean) { signedIn = value; }, set allowed(value: boolean) { allowed = value; },
    set omitInline(value: boolean) { omitInline = value; },
    set truncated(value: boolean) { truncated = value; }, set brokenBlob(value: string | undefined) { brokenBlob = value; },
    set incompleteBlob(value: string | undefined) { incompleteBlob = value; }, set cacheFailure(value: boolean) { cacheFailure = value; },
    remove: (path: string, data: any = {}, origin?: string) => fileRoute.DELETE(request(path, "DELETE", { type: "media", name: "assets", sha: files.get(path)?.sha, ...data }, origin), context(path)),
    rename: (path: string, newPath: string, data: any = {}) => renameRoute.POST(request(path, "POST", { type: "media", name: "assets", sha: files.get(path)?.sha, newPath, configSha: files.get(".pages.yml")!.sha, ...data }), context(path)),
    save: (path: string, content: unknown, data: any = {}) => fileRoute.POST(request(path, "POST", { type: "content", name: "settings", sha: files.get(path)?.sha, configSha: files.get(".pages.yml")!.sha, content, ...data }), context(path)),
    mutateMetadata: (operation: any, metadataOptions: any = {}) => load("lib/github-media-metadata.ts").mutateMediaMetadata({ token: "fixture-token", ...ref, contentName: "assets", ...metadataOptions }, operation),
    externalCommit: (changes: Record<string, unknown>) => { for (const [path, value] of Object.entries(changes)) { if (value === undefined) files.delete(path); else setFile(path, value); } head = `external-${sequence++}`; checkpoint(); },
    holdUpdates: () => { holdUpdates = true; },
    waitForUpdates: async (count: number) => { while (updates.length < count) await new Promise<void>(resolve => listeners.push(resolve)); },
    releaseUpdate: (index: number) => { assert(updates[index]); updates[index].release(); updates[index].done = true; },
    stopHoldingUpdates: () => { holdUpdates = false; },
  };
}
