import assert from 'node:assert/strict';
import test from 'node:test';
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';
// Next's test helpers expect the global initialized by its server bootstrap.
Object.assign(globalThis, { AsyncLocalStorage });
import { MAX_UPLOAD_BYTES, MAX_FILE_REQUEST_BYTES, assertUploadSize, assertMediaContent, assertFileWriteOrigin, readFileRequest } from '../lib/upload-limits.ts';
const require = createRequire(import.meta.url);
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server');
const proxyCode = ts.transpileModule(readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} as any };
new Function('require', 'module', 'exports', proxyCode)(require, mod, mod.exports);
const status = (n: number) => (error: any) => error.status === n;

test('exact file boundary accepts 7.5 MB and rejects the next byte before encoding', () => {
  assertUploadSize(MAX_UPLOAD_BYTES);
  assert.throws(() => assertUploadSize(MAX_UPLOAD_BYTES + 1), status(413));
  assertMediaContent(Buffer.alloc(MAX_UPLOAD_BYTES).toString('base64'));
  assert.throws(() => assertMediaContent(Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64')), status(413));
  assert.throws(() => assertMediaContent('broken!'), status(400));
});

test('full media JSON survives at the file boundary', async () => {
  const content = Buffer.alloc(MAX_UPLOAD_BYTES, 17).toString('base64');
  const payload = JSON.stringify({ type: 'media', name: 'works_images', content });
  assert.ok(Buffer.byteLength(payload) < MAX_FILE_REQUEST_BYTES);
  const data = await readFileRequest(new Request('https://cms.test', { method: 'POST', body: payload }));
  assert.equal(data.content, content);
});

test('oversized declared and chunked requests are 413 and stop reading', async () => {
  await assert.rejects(readFileRequest(new Request('https://cms.test', { method: 'POST', headers: {'content-length': String(MAX_FILE_REQUEST_BYTES + 1)}, body: '{}' })), status(413));
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  await assert.rejects(readFileRequest(new Request('https://cms.test', { method: 'POST', body, duplex: 'half' } as any)), status(413));
  assert.equal(cancelled, true);
  await assert.rejects(readFileRequest(new Request('https://cms.test', { method: 'POST', body: '{"content":"cut' })), status(400));
});

test('file and order routes bypass body cloning; other API routes keep proxy protection', () => {
  for (const path of ['/api/owner/repo/main/files/photo.jpg', '/api/owner/repo/feature%2Ftest/files/images%2Fphoto.jpg', '/api/owner/repo/main/files/page.json', '/api/owner/repo/main/collections/jobs/order', '/api/owner/repo/feature%2Ftest/collections/jobs/order/']) {
    assert.equal(unstable_doesMiddlewareMatch({config: mod.exports.config, nextConfig: {}, url: path}), false, path);
  }
  for (const path of ['/api/owner/repo/main/references/works', '/api/owner/repo/main/collections/jobs', '/api/owner/repo/main/collections/jobs/order/other', '/api/auth/session', '/api/owner/repo/main/files/photo.jpg/rename', '/api/owner/repo/main/files/images%2Fphoto.jpg/rename', '/owner/repo/main/file/home']) {
    assert.equal(unstable_doesMiddlewareMatch({config: mod.exports.config, nextConfig: {}, url: path}), true, path);
  }
});

test('the proxy returns a real 404 for fixture routes unless development explicitly enables them', () => {
  const previous = process.env.PAGESCMS_FIXTURES_ENABLED;
  delete process.env.PAGESCMS_FIXTURES_ENABLED;
  const response = mod.exports.proxy({nextUrl: {pathname: '/dev/fixtures/entry-duplicate'}});
  assert.equal(response.status, 404);
  if (previous === undefined) delete process.env.PAGESCMS_FIXTURES_ENABLED;
  else process.env.PAGESCMS_FIXTURES_ENABLED = previous;
});

test('both file write methods retain origin checks including image extensions', () => {
  for (const method of ['POST', 'DELETE']) {
    const make = (origin?: string) => new Request('https://cms.test/api/o/r/main/files/photo.jpg', {method, headers: { host: 'cms.test', ...(origin ? {origin} : {})}});
    assertFileWriteOrigin(make('https://cms.test'));
    assert.throws(() => assertFileWriteOrigin(make('https://evil.test')), status(403));
    assert.throws(() => assertFileWriteOrigin(make()), status(403));
  }
});

test('actual file API rejects excess media and malformed bodies before any GitHub write', async () => {
  const f = cmsGitFixture({ media: [{ name: "assets", input: "images", output: "/images" }] });
  assert.equal((await f.save("images/test.jpg", Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64"), { type: "media", name: "assets", sha: undefined })).status, 413);
  const route = f.load("app/api/[owner]/[repo]/[branch]/files/[path]/route.ts");
  const request = (body: string, origin = "https://cms.test") => new Request("https://cms.test/api/fixture/private/main/files/images%2Ftest.jpg", { method: "POST", headers: { host: "cms.test", origin }, body });
  const context = { params: Promise.resolve({ owner: "fixture", repo: "private", branch: "main", path: "images/test.jpg" }) };
  assert.equal((await route.POST(request('{"content":"cut'), context)).status, 400);
  assert.equal((await route.POST(request('{}', 'https://evil.test'), context)).status, 403);
  assert.equal((await f.remove("images/test.jpg", {}, "https://evil.test")).status, 403);
  assert.deepEqual(f.mutations, []);
});

test('actual media upload and replacement routes reject manual relationships before mutation', async () => {
  const f = cmsGitFixture({ mediaMetadata: "data/media.json", media: [{ name: "assets", input: "images", output: "/images" }] }, { "images/test.jpg": "existing" });
  for (const sha of [undefined, f.files.get("images/test.jpg")!.sha]) for (const derivedFrom of ["images/source.jpg", null]) {
    const result = await f.save("images/test.jpg", Buffer.from("new").toString("base64"), { type: "media", name: "assets", sha, classification: "generated", derivedFrom });
    assert.equal(result.status, 400);
  }
  assert.deepEqual(f.mutations, []);
});

test('generic content/media writes cannot overwrite, delete or rename the reserved manifest', async () => {
  const f = cmsGitFixture({ mediaMetadata: "data/media.json", media: [{ name: "assets", input: "", output: "/" }], content: [{ name: "entries", type: "collection", path: "data", filename: "{primary}.json" }] }, { "data/media.json": { version: 1, assets: {} }, "data/other.json": {} });
  for (const type of ["content", "media"]) {
    assert.equal((await f.save("data/media.json", "{}", { type, name: type === "media" ? "assets" : "entries" })).status, 400);
    assert.equal((await f.remove("data/media.json", { type, name: type === "media" ? "assets" : "entries" })).status, 400);
    assert.equal((await f.rename("data/media.json", "data/third.json", { type, name: type === "media" ? "assets" : "entries" })).status, 400);
    assert.equal((await f.rename("data/other.json", "data/media.json", { type, name: type === "media" ? "assets" : "entries" })).status, 400);
  }
  assert.deepEqual(f.mutations, []);
});

test('rich-text paste/drop/slash upload failures expose the size explanation through a toast', async () => {
  // Execute the actual handler with the editor and notification surfaces replaced.
  const source = ts.createSourceFile('editor.tsx', readFileSync(new URL('../components/ui/editor/index.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'insertLocalImageFile') handler = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler);
  const code = ts.transpileModule(`const handler = ${handler.getText(source)};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  for (const sourceType of ['paste', 'drop', 'slash']) {
    const messages: string[] = [];
    const chain: any = {focus: () => chain, insertContent: () => chain, run: () => {}};
    let storedMessage: string | undefined;
    const dependencies: Record<string, any> = {
      createUploadId: () => 'id', URL: {createObjectURL: () => 'blob:test'},
      objectUrlByUploadIdRef: {current: new Map()}, expectedBlobByUploadIdRef: {current: new Map()},
      updatePendingUploads: () => {}, editor: {chain: () => chain},
      onUploadImage: async (file: any) => assertUploadSize(file.size),
      finalizeImageUpload: (_id: string, update: any) => {storedMessage = update({}).uploadError;},
      cleanupUpload: () => {}, toast: {error: (message: string) => messages.push(message)},
    };
    const run = new Function(...Object.keys(dependencies), `${code}\nreturn handler;`)(...Object.values(dependencies));
    await run({name: 'painting.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1}, sourceType);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /painting.jpg.*7\.5 MB/);
    assert.match(storedMessage!, /7\.5 MB/);
  }
});
