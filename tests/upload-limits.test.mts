import assert from 'node:assert/strict';
import test from 'node:test';
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

test('file routes bypass body cloning; other API routes keep proxy protection', () => {
  for (const path of ['/api/owner/repo/main/files/photo.jpg', '/api/owner/repo/feature%2Ftest/files/images%2Fphoto.jpg', '/api/owner/repo/main/files/page.json']) {
    assert.equal(unstable_doesMiddlewareMatch({config: mod.exports.config, nextConfig: {}, url: path}), false, path);
  }
  for (const path of ['/api/owner/repo/main/references/works', '/api/auth/session', '/api/owner/repo/main/files/photo.jpg/rename', '/api/owner/repo/main/files/images%2Fphoto.jpg/rename', '/owner/repo/main/file/home']) {
    assert.equal(unstable_doesMiddlewareMatch({config: mod.exports.config, nextConfig: {}, url: path}), true, path);
  }
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
  const limits = await import('../lib/upload-limits.ts');
  let writes = 0;
  const mocks: Record<string, any> = {
    '@/lib/upload-limits': limits,
    '@/lib/session-server': {requireApiUserSession: async () => ({user: {id: 'test'}})},
    '@/lib/token': {getToken: async () => ({token: 'test'})},
    '@/lib/config-store': {getConfig: async () => ({object: {}})},
    '@/lib/schema': {getSchemaByName: () => ({input: 'images', extensions: ['jpg']})},
    '@/lib/utils/file': {normalizePath: (p: string) => p, getFileName: (p: string) => p.split('/').pop(), getFileExtension: () => 'jpg'},
    '@/lib/utils/octokit': {createOctokitInstance: () => {writes++; throw new Error('Unexpected GitHub access');}},
    '@/lib/api-error': {toErrorResponse: (e: any) => Response.json({status: 'error', message: e.message}, {status: e.status ?? 500})},
  };
  const source = readFileSync(new URL('../app/api/[owner]/[repo]/[branch]/files/[path]/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText;
  const route = {exports: {} as any};
  new Function('require', 'module', 'exports', compiled)((id: string) => mocks[id] ?? {}, route, route.exports);
  const context = {params: Promise.resolve({owner: 'o', repo: 'r', branch: 'main', path: 'images/test.jpg'})};
  const make = (body: string, origin = 'https://cms.test') => new Request('https://cms.test/api/o/r/main/files/images%2Ftest.jpg', {method: 'POST', headers: {host: 'cms.test', origin}, body});
  const excess = JSON.stringify({type: 'media', name: 'works_images', content: Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64')});
  assert.equal((await route.exports.POST(make(excess), context)).status, 413);
  assert.equal((await route.exports.POST(make('{"content":"cut'), context)).status, 400);
  assert.equal((await route.exports.POST(make('{}', 'https://evil.test'), context)).status, 403);
  assert.equal((await route.exports.DELETE(make('{}', 'https://evil.test'), context)).status, 403);
  assert.equal(writes, 0);
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
