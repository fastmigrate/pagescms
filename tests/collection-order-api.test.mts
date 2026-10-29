import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { MAX_FILE_REQUEST_BYTES } from "../lib/upload-limits.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const hash = (value: string) => createHash("sha1").update(value).digest("hex");
const baseHead = hash("head");
const nextHead = hash("next-head");
const baseTree = hash("base-tree");
const defaultConfig = () => ({
  settings: { commit: { identity: "user", templates: { update: "Global {name}" } } },
  content: [{
    name: "jobs", type: "collection", path: "content/jobs", subfolders: false,
    filename: "{fields.id}.json", format: "json",
    commit: { templates: { update: "Reorder {name} at {path} by {userName}" } },
    fields: [
      { name: "id", type: "string", hidden: true },
      { name: "title", type: "string" },
      { name: "department", type: "string" },
      { name: "sortOrder", type: "number", hidden: true },
      { name: "optional", type: "object", fields: [{ name: "defaulted", type: "string", default: "Keep absent" }] },
    ],
    view: {
      primary: "title", reorder: { field: "sortOrder", sortPreset: "website" },
      sortPresets: [{ name: "website", label: "Website", fields: [
        { field: "department", order: "asc", values: ["a", "b"] },
        { field: "sortOrder", order: "asc" }, { field: "id", order: "asc" },
      ] }],
    },
  }],
});
const defaultDocuments = () => ({
  "content/jobs/a.json": { id: "a", title: "Alpha", department: "a", sortOrder: 10, body: "\nUnchanged body\n", future: { empty: "", nil: null, list: [null, "", {}, []], enabled: false, count: 0 }, summary: null },
  "content/jobs/b.json": { id: "b", title: "Beta", department: "a", sortOrder: 20, future: { keep: true } },
  "content/jobs/c.json": { id: "c", title: "Other group", department: "b", sortOrder: 99 },
});
type Options = {
  config?: any;
  documents?: Record<string, unknown>;
  signedIn?: boolean;
  allowed?: boolean;
  collaborator?: boolean;
  noGithubAccount?: boolean;
  conflict?: boolean | 409 | 422;
  truncated?: boolean;
  cacheFailure?: boolean;
  invalidateFailure?: boolean;
  deniedWrite?: boolean;
  readFailure?: boolean;
  modes?: Record<string, string>;
};

function fixture(options: Options = {}) {
  const config = options.config ?? defaultConfig();
  const files = new Map<string, { content: string; sha: string; mode: string }>();
  const blobs = new Map<string, string>();
  const originalDocuments = options.documents ?? defaultDocuments();
  function put(path: string, value: unknown, mode = "100644") {
    const content = typeof value === "string" ? value : JSON.stringify(value);
    const sha = hash(content);
    files.set(path, { content, sha, mode });
    blobs.set(sha, content);
  }
  put(".pages.yml", config);
  for (const [path, value] of Object.entries(originalDocuments)) put(path, value, options.modes?.[path]);
  let head = baseHead;
  let treeChanges: any[] = [];
  let writes = 0;
  let refReads = 0;
  let cleared = 0;
  let updated = false;
  const createdBlobs: any[] = [];
  const createdTrees: any[] = [];
  const createdCommits: any[] = [];
  const refUpdates: any[] = [];
  const cached: any[] = [];
  const tokens: any[] = [];
  const reads: string[] = [];
  const user = { id: "fixture-user", name: "Fixture Editor", email: "editor@example.invalid", emailVerified: true };
  const octokit = { rest: {
    repos: { get: async () => {
      if (options.allowed === false) throw Object.assign(new Error("Repository denied"), { status: 403 });
      return { data: {} };
    } },
    git: {
      getRef: async () => {
        refReads++;
        if (options.readFailure) throw Object.assign(new Error("GitHub temporarily unavailable. Please retry."), { status: 503 });
        return { data: { object: { sha: head } } };
      },
      getCommit: async ({ commit_sha }: any) => {
        assert.equal(commit_sha, head);
        return { data: { tree: { sha: baseTree } } };
      },
      getTree: async ({ tree_sha, recursive }: any) => {
        assert.equal(tree_sha, baseTree);
        assert.equal(recursive, "true");
        return { data: { truncated: options.truncated ?? false, tree: [...files].map(([path, file]) => ({ path, sha: file.sha, mode: file.mode, type: "blob", size: Buffer.byteLength(file.content) })) } };
      },
      getBlob: async ({ file_sha }: any) => {
        const content = blobs.get(file_sha);
        assert.notEqual(content, undefined, "immutable tree SHA must identify every read");
        reads.push(file_sha);
        return { data: { content: Buffer.from(content!).toString("base64"), size: Buffer.byteLength(content!) } };
      },
      createBlob: async (input: any) => {
        writes++;
        if (options.deniedWrite) throw Object.assign(new Error("GitHub write permission denied."), { status: 403 });
        createdBlobs.push(input);
        assert.equal(input.encoding, "utf-8");
        const sha = hash(input.content);
        blobs.set(sha, input.content);
        return { data: { sha } };
      },
      createTree: async (input: any) => {
        writes++;
        createdTrees.push(input);
        treeChanges = input.tree;
        return { data: { sha: hash("next-tree") } };
      },
      createCommit: async (input: any) => {
        writes++;
        createdCommits.push(input);
        return { data: { sha: nextHead } };
      },
      updateRef: async (input: any) => {
        writes++;
        refUpdates.push(input);
        if (options.conflict) throw Object.assign(new Error("Non-fast-forward"), { status: options.conflict === true ? 422 : options.conflict });
        assert.equal(input.force, false);
        for (const entry of treeChanges) files.set(entry.path, { content: blobs.get(entry.sha)!, sha: entry.sha, mode: entry.mode });
        head = input.sha;
        updated = true;
        return { data: {} };
      },
    },
  } };
  const registry = { fieldTypes: new Set(["string", "number", "object", "uuid", "select", "boolean", "date", "text"]), schemas: {}, defaultValues: {}, readFns: {} as Record<string, any> };
  const modules = new Map<string, { exports: any }>();
  const mocks: Record<string, any> = {
    "@/fields/registry": registry,
    "@/lib/utils/octokit": { createOctokitInstance: (token: string, retryOptions?: any) => { tokens.push({ token, retryOptions }); return octokit; } },
    "@/lib/github-cache-file": {
      setBranchHeadSha: (...args: any[]) => { cached.push({ head: args }); },
      updateFileCache: async (...args: any[]) => { if (options.cacheFailure) throw new Error("Cache unavailable"); cached.push(args); },
      clearFileCache: async () => { cleared++; if (options.invalidateFailure) throw new Error("Cache still unavailable"); },
    },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth": { auth: { api: { getSession: async () => options.signedIn === false ? null : { user } } } },
    "@/lib/github-account": { getGithubAccount: async () => options.noGithubAccount ? undefined : { accessToken: "user-token" } },
    "@octokit/app": { App: class { octokit = { request: async () => ({ data: { id: 202 } }) }; } },
    "@/lib/crypto": { decrypt: async (value: string) => value },
    "@/db": { db: { query: {
      collaboratorTable: { findFirst: async () => options.collaborator ? { email: user.email, userId: null } : undefined },
      githubInstallationTokenTable: { findFirst: async () => ({ ciphertext: "installation-token", iv: "unused", expiresAt: new Date(Date.now() + 3_600_000) }) },
    } } },
  };
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path)!.exports;
    const loadedModule = { exports: {} };
    modules.set(path, loadedModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const require = (specifier: string): any => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (["./view-component", "./edit-component"].includes(specifier)) return {};
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return nativeRequire(specifier);
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
      const found = [base, `${base}.ts`, `${base}.tsx`].find(path => existsSync(path));
      if (!found) throw new Error(`Unresolved test dependency ${specifier}`);
      return load(found);
    };
    new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  registry.readFns.date = load(resolve(root, "fields/core/date/index.ts")).read;
  const service = load(resolve(root, "lib/github-collection-order.ts"));
  const route = load(resolve(root, "app/api/[owner]/[repo]/[branch]/collections/[name]/order/route.ts"));
  const context = { owner: "fixture", repo: "private", branch: "main", name: "jobs", token: "user-token", user };
  const params = () => ({ params: Promise.resolve({ owner: context.owner, repo: context.repo, branch: context.branch, name: context.name }) });
  const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://cms.invalid/api/fixture/private/main/collections/jobs/order", {
    method: "POST", headers: { host: "cms.invalid", origin: "https://cms.invalid", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    read: () => service.readCollectionOrder(context),
    save: (input: unknown) => service.saveCollectionOrder(context, input),
    get: () => route.GET(new Request("https://cms.invalid/api/order"), params()),
    post: (input: unknown, headers?: Record<string, string>) => route.POST(request(input, headers), params()),
    payload: async (paths?: string[], groupIndex = 0) => {
      const snapshot = await service.readCollectionOrder(context);
      return { expectedHead: snapshot.head, configSha: snapshot.configSha, groups: snapshot.groups.map((group: any, index: number) => ({ id: group.id, baseline: group.entries.map(({ path, sha }: any) => ({ path, sha })), paths: index === groupIndex && paths ? paths : group.entries.map((entry: any) => entry.path) })) };
    },
    value: (path: string) => JSON.parse(files.get(path)!.content),
    advance: () => { head = hash("unrelated-commit"); },
    files, put, createdBlobs, createdTrees, createdCommits, refUpdates, cached, tokens, reads,
    get head() { return head; }, get writes() { return writes; }, get refReads() { return refReads; },
    get updated() { return updated; }, get cleared() { return cleared; },
  };
}

function changeGroup(input: any, patch: any, index = 0) {
  return { ...input, groups: input.groups.map((group: any, current: number) => current === index ? { ...group, ...patch } : group) };
}

test("order snapshot includes the complete group beyond normal pagination and uses preset tie breakers", async () => {
  const documents = Object.fromEntries(Array.from({ length: 34 }, (_, index) => [`content/jobs/${index}.json`, {
    id: String(index).padStart(2, "0"), title: `Entry ${index}`, department: index < 32 ? "a" : "b", ...(index === 31 ? {} : { sortOrder: index % 2 }),
  }]));
  const f = fixture({ documents });
  const snapshot = await f.read();
  assert.equal(snapshot.head, baseHead);
  assert.equal(snapshot.configSha, f.files.get(".pages.yml")!.sha);
  assert.equal(snapshot.field, "sortOrder");
  assert.deepEqual(snapshot.groups.map((group: any) => group.entries.length), [32, 2]);
  assert.deepEqual(snapshot.groups[0].entries.slice(0, 3).map((entry: any) => entry.path), ["content/jobs/0.json", "content/jobs/2.json", "content/jobs/4.json"]);
  assert.equal(snapshot.groups[0].entries.at(-1).value, null);
  assert.equal(f.reads.length, 35);
  assert.equal(f.writes, 0);
});

test("one atomic commit changes only the numeric field and preserves other documents, content and identity", async () => {
  const f = fixture({ modes: { "content/jobs/b.json": "100755" } });
  const original = structuredClone(defaultDocuments());
  const input = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
  const result = await f.save(input);
  assert.deepEqual(f.value("content/jobs/a.json"), { ...original["content/jobs/a.json"], sortOrder: 2 });
  assert.deepEqual(f.value("content/jobs/b.json"), { ...original["content/jobs/b.json"], sortOrder: 1 });
  assert.deepEqual(f.value("content/jobs/c.json"), original["content/jobs/c.json"]);
  assert.equal(Object.hasOwn(f.value("content/jobs/a.json"), "optional"), false);
  assert.equal(f.createdBlobs.length, 2);
  assert.equal(f.createdTrees.length, 1);
  assert.equal(f.createdTrees[0].base_tree, baseTree);
  assert.equal(f.createdTrees[0].tree.find((entry: any) => entry.path.endsWith("b.json")).mode, "100755");
  assert.equal(f.createdCommits.length, 1);
  assert.deepEqual(f.createdCommits[0].parents, [baseHead]);
  assert.deepEqual(f.createdCommits[0].committer, { name: "Fixture Editor", email: "editor@example.invalid" });
  assert.equal(f.createdCommits[0].message, "Reorder jobs at content/jobs by Fixture Editor");
  assert.equal(f.refUpdates.length, 1);
  assert.equal(f.refUpdates[0].force, false);
  assert.equal(result.head, nextHead);
  assert.deepEqual(result.groups[0].entries.map((entry: any) => [entry.path, entry.value]), [["content/jobs/b.json", 1], ["content/jobs/a.json", 2]]);
  for (const entry of result.groups[0].entries) assert.equal(entry.sha, f.files.get(entry.path)!.sha);
  assert.equal(f.cached.filter(Array.isArray).length, 2);
  assert(f.tokens.some(({ retryOptions }) => retryOptions?.retry.doNotRetry.includes(422)));
});

test("unchanged identity order is a no-op and preserves sparse stored numbers", async () => {
  const f = fixture();
  const input = await f.payload();
  assert.equal((await f.save(input)).head, baseHead);
  assert.equal(f.writes, 0);
  assert.equal(f.value("content/jobs/a.json").sortOrder, 10);
  assert.equal(f.cached.length, 0);
});

test("stale head, configuration, file revisions and partial or cross-group membership fail before Git writes", async () => {
  const cases = [
    (input: any) => ({ ...input, expectedHead: hash("stale-head") }),
    (input: any) => ({ ...input, configSha: hash("stale-config") }),
    (input: any) => changeGroup(input, { id: "missing" }),
    (input: any) => changeGroup(input, { baseline: input.groups[0].baseline.slice(1) }),
    (input: any) => changeGroup(input, { baseline: [{ ...input.groups[0].baseline[0], sha: hash("stale-file") }, input.groups[0].baseline[1]] }),
    (input: any) => changeGroup(input, { paths: input.groups[0].paths.slice(1) }),
    (input: any) => changeGroup(input, { paths: ["content/jobs/c.json", "content/jobs/a.json"] }),
    (input: any) => changeGroup(input, { paths: ["content/jobs-other/b.json", "content/jobs/a.json"] }),
  ];
  for (const change of cases) {
    const f = fixture();
    const input = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
    await assert.rejects(f.save(change(input)), (error: any) => error.status === 409);
    assert.equal(f.writes, 0);
    assert.equal(f.updated, false);
  }
  const f = fixture();
  const input = await f.payload();
  f.advance();
  await assert.rejects(f.save(input), (error: any) => error.status === 409);
  assert.equal(f.writes, 0);
});

test("duplicate paths, traversal, missing revisions and unsupported request fields fail before writes", async () => {
  for (const change of [
    (input: any) => changeGroup(input, { baseline: [input.groups[0].baseline[0], input.groups[0].baseline[0]] }),
    (input: any) => changeGroup(input, { paths: [input.groups[0].paths[0], input.groups[0].paths[0]] }),
    (input: any) => changeGroup(input, { paths: ["content/jobs/../b.json", input.groups[0].paths[1]] }),
    (input: any) => changeGroup(input, { paths: ["/content/jobs/b.json", input.groups[0].paths[1]] }),
    (input: any) => changeGroup(input, { baseline: [{ path: input.groups[0].paths[0] }] }),
    (input: any) => ({ ...input, field: "arbitrary.path" }),
    (input: any) => ({ ...input, content: {} }),
  ]) {
    const f = fixture();
    await assert.rejects(f.save(change(await f.payload())), (error: any) => error.status === 400);
    assert.equal(f.writes, 0);
  }
});

test("root-level membership excludes sibling paths, subfolders, excluded names and other extensions", async () => {
  for (const root of ["", "content/jobs"]) {
    const config = defaultConfig();
    config.content[0].path = root;
    (config.content[0] as any).exclude = ["ignored.json"];
    const prefix = root ? `${root}/` : "";
    const f = fixture({ config, documents: {
      [`${prefix}a.json`]: { id: "a", title: "A", department: "a", sortOrder: 2 },
      [`${prefix}b.json`]: { id: "b", title: "B", department: "a", sortOrder: 1 },
      [`${prefix}ignored.json`]: "invalid excluded JSON",
      [`${prefix}nested/child.json`]: "invalid nested JSON",
      [`${prefix}readme.txt`]: "Plain text",
      "content/jobs-sibling/other.json": "invalid sibling JSON",
    } });
    const input = await f.payload([`${prefix}a.json`, `${prefix}b.json`]);
    assert.equal(input.groups[0].baseline.length, 2);
    await f.save(input);
    assert.equal(f.createdTrees[0].tree.length, 2);
    assert.equal(f.value(`${prefix}a.json`).sortOrder, 1);
  }
});

test("normalized component fields, nested content names and transformed date groups use the existing comparator", async () => {
  const config: any = defaultConfig();
  config.components = { rank: { component: "base" }, base: { type: "number", hidden: true, options: { min: 0.5, step: 0.25, max: 2 } } };
  config.content[0].fields = [
    { name: "id", type: "string" }, { name: "title", type: "string" }, { name: "path", type: "string" },
    { name: "day", type: "date", options: { format: "dd/MM/yyyy" } },
    { name: "fields", type: "object", required: true, fields: [{ name: "rank", component: "rank" }] },
  ];
  config.content[0].view.reorder.field = "fields.rank";
  config.content[0].view.sortPresets[0].fields = [
    { field: "day", order: "asc", values: ["02/01/2026", "01/01/2026"] },
    { field: "path", order: "asc" }, { field: "fields.rank", order: "asc" }, { field: "id", order: "asc" },
  ];
  const documents = {
    "content/jobs/a.json": { id: "a", title: "A", path: "same", day: "02/01/2026", fields: { rank: null, unknown: [null, ""] }, unknown: {} },
    "content/jobs/b.json": { id: "b", title: "B", path: "same", day: "02/01/2026", fields: { rank: 1, unknown: false } },
    "content/jobs/c.json": { id: "c", title: "C", path: "same", day: "01/01/2026", fields: { rank: 1 } },
  };
  const f = fixture({ config, documents });
  const snapshot = await f.read();
  assert.match(snapshot.groups[0].id, /2026-01-02/);
  assert.deepEqual(snapshot.groups[0].entries.map((entry: any) => entry.path), ["content/jobs/b.json", "content/jobs/a.json"]);
  const result = await f.save(await f.payload(["content/jobs/a.json", "content/jobs/b.json"]));
  assert.deepEqual(result.groups[0].entries.map((entry: any) => entry.value), [0.5, 0.75]);
  assert.deepEqual(f.value("content/jobs/a.json"), { ...documents["content/jobs/a.json"], fields: { rank: 0.5, unknown: [null, ""] } });
  assert.deepEqual(f.value("content/jobs/c.json"), documents["content/jobs/c.json"]);
});

test("unsafe current configurations and content shapes never create Git objects", async () => {
  const configurations = [
    (config: any) => { config.unknownRootOption = true; },
    (config: any) => { config.content[0].format = "yaml"; },
    (config: any) => { config.content[0].list = true; },
    (config: any) => { config.content[0].subfolders = true; },
    (config: any) => { config.content[0].view.layout = "tree"; },
    (config: any) => { config.content[0].path = "content/../jobs"; },
    (config: any) => { config.content[0].fields[3].options = { max: 1 }; },
  ];
  for (const change of configurations) {
    const config = defaultConfig();
    change(config);
    const f = fixture({ config });
    await assert.rejects(f.read(), (error: any) => error.status === 400);
    assert.equal(f.writes, 0);
  }
  for (const source of ["{", "[]", "null", "42"]) {
    const f = fixture({ documents: { "content/jobs/a.json": source } });
    await assert.rejects(f.read(), (error: any) => error.status === 400);
    assert.equal(f.writes, 0);
  }
  for (const missingParent of [undefined, null, [], "value"]) {
    const config: any = defaultConfig();
    config.content[0].fields[3] = { name: "meta", type: "object", required: true, fields: [{ name: "rank", type: "number" }] };
    config.content[0].view.reorder.field = "meta.rank";
    config.content[0].view.sortPresets[0].fields[1].field = "meta.rank";
    const f = fixture({ config, documents: { "content/jobs/a.json": { id: "a", department: "a", meta: missingParent } } });
    await assert.rejects(f.read(), (error: any) => error.status === 400);
    assert.equal(f.writes, 0);
  }
});

test("truncated snapshots and symbolic collection files are refused before writes", async () => {
  const truncated = fixture({ truncated: true });
  await assert.rejects(truncated.read(), (error: any) => error.status === 413);
  for (const path of [".pages.yml", "content/jobs/a.json"]) {
    const f = fixture({ modes: { [path]: "120000" } });
    if (path === ".pages.yml") f.put(path, defaultConfig(), "120000");
    await assert.rejects(f.read(), (error: any) => error.status === 400);
    assert.equal(f.writes, 0);
  }
});

test("a branch race returns conflict without any partial ref or file update and without retry", async () => {
  const f = fixture({ conflict: true });
  await assert.rejects(f.save(await f.payload(["content/jobs/b.json", "content/jobs/a.json"])), (error: any) => error.status === 409);
  assert.equal(f.createdTrees.length, 1);
  assert.equal(f.createdCommits.length, 1);
  assert.equal(f.refUpdates.length, 1);
  assert.equal(f.head, baseHead);
  assert.equal(f.updated, false);
  assert.deepEqual(f.value("content/jobs/a.json"), defaultDocuments()["content/jobs/a.json"]);
  assert.equal(f.cached.length, 0);
});

test("a completed Git write stays successful when cache update and invalidation fail", async t => {
  const errors: any[] = [];
  t.mock.method(console, "error", (...args: any[]) => { errors.push(args); });
  const f = fixture({ cacheFailure: true, invalidateFailure: true });
  const response = await f.post(await f.payload(["content/jobs/b.json", "content/jobs/a.json"]));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "success");
  assert.equal(result.data.head, nextHead);
  assert.equal(f.updated, true);
  assert.equal(f.cleared, 1);
  assert.equal(errors.length, 2);
  assert.equal(f.value("content/jobs/b.json").sortOrder, 1);
});

test("actual order route uses production session and token authorization before repository reads", async t => {
  t.mock.method(console, "error", () => {});
  for (const [options, status] of [[{ signedIn: false }, 401], [{ allowed: false }, 403], [{ noGithubAccount: true }, 403]] as const) {
    const f = fixture(options);
    assert.equal((await f.get()).status, status);
    assert.equal((await f.post({})).status, status);
    assert.equal(f.refReads, 0);
    assert.equal(f.writes, 0);
  }
});

test("email collaborators keep installation-token access and can save through the actual order route", async () => {
  const f = fixture({ noGithubAccount: true, collaborator: true });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "success");
  const input = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
  const saved = await f.post(input);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.head, nextHead);
  assert(f.tokens.some(({ token }) => token === "installation-token"));
  assert.equal(f.refUpdates.length, 1);
});

test("actual route rejects wrong origin, incomplete JSON and oversized requests without GitHub writes", async t => {
  t.mock.method(console, "error", () => {});
  for (const [body, headers, status] of [
    [{}, { origin: "https://evil.invalid" }, 403],
    ["{", {}, 400],
    [{}, { "content-length": String(MAX_FILE_REQUEST_BYTES + 1) }, 413],
    [" ".repeat(MAX_FILE_REQUEST_BYTES + 1), {}, 413],
    [{}, {}, 400],
  ] as const) {
    const f = fixture();
    const response = await f.post(body, headers);
    assert.equal(response.status, status);
    assert.equal((await response.json()).status, "error");
    assert.equal(f.writes, 0);
    assert.equal(f.refReads, 0);
  }
});

test("actual route reports GitHub read errors, write denial and branch conflicts as actionable JSON", async t => {
  t.mock.method(console, "error", () => {});
  const failingRead = fixture({ readFailure: true });
  const readResponse = await failingRead.get();
  assert.equal(readResponse.status, 503);
  assert.match((await readResponse.json()).message, /retry/i);
  for (const [options, status] of [[{ deniedWrite: true }, 403], [{ conflict: 409 }, 409], [{ conflict: 422 }, 409]] as const) {
    const f = fixture(options);
    const response = await f.post(await f.payload(["content/jobs/b.json", "content/jobs/a.json"]));
    assert.equal(response.status, status);
    assert.equal((await response.json()).status, "error");
    assert.equal(f.updated, false);
    assert.equal(f.head, baseHead);
  }
});


test("numeric order edits preserve every unrelated JSON byte including large numeric literals", async () => {
  const first = '{\r\n  "id": "a", "title": "Alpha", "department": "a",\r\n  "sortOrder" : 10, "futureId":1234567890123456789, "overflow":1e400, "escaped":"\\u0041"\r\n}\r\n';
  const second = '{ "id":"b", "title":"Beta", "department":"a", "sortOrder":20, "futureId":9007199254740993 }';
  const f = fixture({ documents: { "content/jobs/a.json": first, "content/jobs/b.json": second } });
  await f.save(await f.payload(["content/jobs/b.json", "content/jobs/a.json"]));
  assert.equal(f.files.get("content/jobs/a.json")!.content, first.replace('"sortOrder" : 10', '"sortOrder" : 2'));
  assert.equal(f.files.get("content/jobs/b.json")!.content, second.replace('"sortOrder":20', '"sortOrder":1'));
});

test("reserved media metadata cannot enter a matching order scope unless explicitly excluded", async () => {
  const config: any = defaultConfig();
  config.mediaMetadata = "content/jobs/metadata.json";
  config.content[0].view.reorder.field = "version";
  config.content[0].view.sortPresets[0].fields = [{ field: "version", order: "asc" }];
  config.content[0].fields.push({ name: "version", type: "number" });
  const documents = { "content/jobs/a.json": { id: "a", title: "Alpha", version: 2 }, "content/jobs/metadata.json": { version: 1, assets: {} } };
  const f = fixture({ config, documents });
  await assert.rejects(f.read(), (error: any) => error.status === 400 && /reserved|metadata/i.test(error.message));
  await assert.rejects(f.save({ expectedHead: baseHead, configSha: f.files.get(".pages.yml")!.sha, groups: [{ id: "[]", baseline: [], paths: [] }] }), (error: any) => error.status === 400);
  assert.equal(f.writes, 0);
  config.content[0].exclude = ["metadata.json"];
  const excluded = fixture({ config, documents });
  assert.deepEqual((await excluded.read()).groups[0].entries.map((entry: any) => entry.path), ["content/jobs/a.json"]);
  assert.equal(excluded.writes, 0);
});


test("nested numeric edits and absent optional leaves preserve neighboring raw source", async () => {
  const config: any = defaultConfig();
  config.content[0].fields[3] = { name: "meta", type: "object", required: true, fields: [{ name: "rank", type: "number" }] };
  config.content[0].view.reorder.field = "meta.rank";
  config.content[0].view.sortPresets[0].fields[1].field = "meta.rank";
  const first = '{ "id":"a", "title":"A", "department":"a", "meta" : { "rank" : 10, "futureId":1234567890123456789 }, "overflow":1e400 }\n';
  const second = '{"id":"b","title":"B","department":"a","meta":{"futureId":9007199254740993}}';
  const f = fixture({ config, documents: { "content/jobs/a.json": first, "content/jobs/b.json": second } });
  await f.save(await f.payload(["content/jobs/b.json", "content/jobs/a.json"]));
  assert.equal(f.files.get("content/jobs/a.json")!.content, first.replace('"rank" : 10', '"rank" : 2'));
  assert.equal(f.files.get("content/jobs/b.json")!.content, second.replace('9007199254740993}', '9007199254740993,"rank": 1}'));
  assert.deepEqual(f.value("content/jobs/a.json").meta.rank, 2);
  assert.deepEqual(f.value("content/jobs/b.json").meta.rank, 1);
});


test("duplicate order keys cannot report a successful numeric edit of a shadowed property", async () => {
  const f = fixture({ documents: {
    "content/jobs/a.json": '{"id":"a","department":"a","sortOrder":3,"sortOrder":10}',
    "content/jobs/b.json": '{"id":"b","department":"a","sortOrder":20}',
  } });
  await assert.rejects(f.save(await f.payload(["content/jobs/b.json", "content/jobs/a.json"])), (error: any) => error.status === 400 && /duplicate JSON keys/i.test(error.message));
  assert.equal(f.writes, 0);
});

test("two dirty groups are saved in one commit and unchanged sparse groups retain their exact bytes", async () => {
  const documents = { ...defaultDocuments(),
    "content/jobs/d.json": { id: "d", title: "Second B", department: "b", sortOrder: 100 },
    "content/jobs/e.json": '{ "id":"e", "title":"Sparse", "department":"c", "sortOrder":900, "future":1234567890123456789 }',
    "content/jobs/f.json": '{"id":"f","department":"c"}',
  };
  const f = fixture({ documents });
  const originalSparse = ["content/jobs/e.json", "content/jobs/f.json"].map(path => ({ path, ...f.files.get(path)! }));
  const input = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
  input.groups[1].paths.reverse();
  const result = await f.save(input);
  assert.equal(f.createdCommits.length, 1);
  assert.equal(f.refUpdates.length, 1);
  assert.equal(f.createdBlobs.length, 4);
  assert.deepEqual(result.groups.slice(0, 2).map((group: any) => group.entries.map((entry: any) => entry.path)), [input.groups[0].paths, input.groups[1].paths]);
  for (const { path, ...original } of originalSparse) assert.deepEqual(f.files.get(path), original);
});

test("invalid second group rejects all changes before any Git object is created", async () => {
  for (const corrupt of [
    (input: any) => changeGroup(input, { paths: [] }, 1),
    (input: any) => changeGroup(input, { baseline: [] }, 1),
    (input: any) => ({ ...input, groups: input.groups.slice(0, 1) }),
    (input: any) => ({ ...input, groups: [input.groups[0], input.groups[0]] }),
  ]) {
    const f = fixture();
    await assert.rejects(f.save(corrupt(await f.payload(["content/jobs/b.json", "content/jobs/a.json"]))));
    assert.equal(f.writes, 0);
  }
  const f = fixture({ documents: { ...defaultDocuments(),
    "content/jobs/c.json": '{"id":"c","department":"b","sortOrder":3,"sortOrder":99}',
    "content/jobs/d.json": { id: "d", department: "b", sortOrder: 100 },
  } });
  const input = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
  input.groups[1].paths.reverse();
  await assert.rejects(f.save(input), (error: any) => error.status === 400);
  assert.equal(f.writes, 0, "numeric patches for every group are prepared before creating blobs");
});

test("snapshot uses select labels with stable group identities and qualifies multi-field labels", async () => {
  const config: any = defaultConfig();
  config.content[0].fields[2] = { name: "department", label: "Bereich", type: "select", options: { values: [{ value: "a", label: "Presse" }, { value: "b", label: "TV" }] } };
  const f = fixture({ config });
  const snapshot = await f.read();
  assert.deepEqual(snapshot.groups.map((group: any) => [group.id, group.label]), [['["a"]', "Presse"], ['["b"]', "TV"]]);
  config.content[0].view.sortPresets[0].fields.splice(1, 0, { field: "title", order: "asc" });
  config.content[0].fields[1].label = "Titel";
  assert.equal((await fixture({ config }).read()).groups[0].label, "Bereich: Presse / Titel: Alpha");
});

test("order snapshots project configured read-transformed columns and saves accept only numeric ordering metadata", async () => {
  const config: any = defaultConfig();
  config.components = { metadata: { type: "object", fields: [{ name: "date", component: "date" }] }, date: { type: "date", options: { format: "dd.MM.yyyy" } } };
  const schema = config.content[0];
  schema.fields.push({ name: "meta", component: "metadata" }, { name: "event", type: "string" }, { name: "enabled", type: "boolean" }, { name: "count", type: "number" });
  schema.view.fields = ["title", { name: "when", label: "Date or event", fallback: ["meta.date", "event"] }, "sortOrder", "enabled", "count"];
  const documents: any = defaultDocuments();
  Object.assign(documents["content/jobs/a.json"], { meta: { date: "29.10.2026", private: "omit" }, event: "Autumn", enabled: false, count: 0 });
  Object.assign(documents["content/jobs/b.json"], { meta: { date: "" }, event: "Autumn", enabled: true });
  Object.assign(documents["content/jobs/c.json"], { meta: { date: "" }, event: "   " });
  const f = fixture({ config, documents });
  const snapshot = await f.read();
  assert.deepEqual(snapshot.columns.map((column: any) => column.id), ["title", "display:when", "sortOrder", "enabled", "count"]);
  assert.equal(snapshot.columns[1].sources[0].field.type, "date");
  assert.deepEqual(snapshot.columns[1].sources[0].field.options, { format: "dd.MM.yyyy" });
  const first = snapshot.groups[0].entries[0];
  assert.deepEqual(JSON.parse(JSON.stringify(first.fields)), { title: "Alpha", meta: { date: "2026-10-29" }, event: "Autumn", sortOrder: 10, enabled: false, count: 0 });
  assert.equal(Object.hasOwn(first.fields, "future"), false);
  const payload = await f.payload(["content/jobs/b.json", "content/jobs/a.json"]);
  await assert.rejects(() => f.save({ ...payload, columns: snapshot.columns }), { status: 400 });
  await assert.rejects(() => f.save({ ...payload, groups: payload.groups.map((group: any) => ({ ...group, fields: first.fields })) }), { status: 400 });
  assert.equal(f.writes, 0);
  const result = await f.save(payload);
  assert.deepEqual(f.value("content/jobs/a.json"), { ...documents["content/jobs/a.json"], sortOrder: 2 });
  assert.deepEqual(f.value("content/jobs/b.json"), { ...documents["content/jobs/b.json"], sortOrder: 1 });
  assert.deepEqual(f.value("content/jobs/c.json"), documents["content/jobs/c.json"]);
  assert.equal(result.groups[0].entries[1].fields.sortOrder, 2);
  assert.equal(result.groups[0].entries[1].fields.meta.date, "2026-10-29");
});
