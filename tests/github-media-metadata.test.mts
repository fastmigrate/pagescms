import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import * as metadata from '../lib/media-metadata.ts';
const sourceSha = 'a'.repeat(40);
function fixture({ conflict = false, stale = false } = {}) {
  const document = {version: 1, assets: {'media/source.jpg': {classification: 'generated', sourceSha256: metadata.fingerprint('image'), sourceGitSha: sourceSha, future: null}, 'media/crop.webp': {derivedFrom: 'media/source.jpg', sourceSha256: metadata.fingerprint('crop')}}, unknown: {nested: [null, '']}};
  let updated = false; let written: any; let delta: any;
  const entries = [{path: 'media/source.jpg', sha: sourceSha, type: 'blob', mode: '100644', size: 5}, {path: 'media/crop.webp', sha: 'b'.repeat(40), type: 'blob', mode: '100644'}, {path: 'data/media.json', sha: 'c'.repeat(40), type: 'blob', mode: '100644'}];
  const octokit = {rest: {git: {
    getRef: async () => ({data: {object: {sha: 'head'}}}),
    getCommit: async () => ({data: {tree: {sha: 'base'}}}),
    getTree: async () => ({data: {tree: entries, truncated: false}}),
    getBlob: async ({file_sha}: any) => ({data: {content: Buffer.from(file_sha === 'c'.repeat(40) ? JSON.stringify(document) : 'image').toString('base64')}}),
    createBlob: async ({content, encoding}: any) => { if (encoding === 'utf-8') written = JSON.parse(content); return {data: {sha: 'd'.repeat(40)}}; },
    createTree: async (value: any) => {delta = value; return {data: {sha: 'new-tree'}};},
    createCommit: async (value: any) => { assert.deepEqual(value.parents, ['head']); return {data: {sha: 'new-head'}};},
    updateRef: async (value: any) => {assert.equal(value.force, false); if (conflict) throw Object.assign(new Error('race'), {status: 422}); updated = true;},
  }}};
  const mocks: Record<string, any> = {
    '@/lib/utils/octokit': {createOctokitInstance: () => octokit},
    '@/lib/api-error': {createHttpError: (message: string, status: number) => Object.assign(new Error(message), {status})},
    '@/lib/github-cache-file': {setBranchHeadSha: async () => {}},
    '@/lib/commit-message': {buildCommitTokens: (value: any) => value, resolveCommitMessage: () => 'Edit media'},
    '@/lib/media-metadata': metadata,
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../lib/github-media-metadata.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  const module = {exports: {} as any}; new Function('require','module','exports',compiled)((key: string) => mocks[key], module, module.exports);
  const options = {owner:'fixture',repo:'private',branch:'main',token:'test',configObject:{mediaMetadata:'data/media.json',media:[{input:'media'}]}};
  return {mutate: (operation: any) => module.exports.mutateMediaMetadata(options, operation), document, get written() {return written;}, get delta() {return delta;}, get updated() {return updated;}};
}
test('rename and metadata share one base-tree commit and preserve unknown fields', async () => {
  const f = fixture(); await f.mutate({action:'rename',path:'media/source.jpg',newPath:'media/new.jpg',sha:sourceSha});
  assert.equal(f.updated,true); assert.equal(f.delta.base_tree,'base'); assert.equal(f.delta.tree.length,3);
  assert.equal(f.written.assets['media/crop.webp'].derivedFrom,'media/new.jpg'); assert.equal(f.written.assets['media/new.jpg'].future,null); assert.deepEqual(f.written.unknown,{nested:[null,'']});
});
test('collision name is chosen before saving its metadata', async () => {
  const f = fixture(); const result = await f.mutate({action:'save',path:'media/source.jpg',content:Buffer.from('new').toString('base64'),classification:'modified'});
  assert.equal(result.path,'media/source-1.jpg'); assert.equal(f.written.assets[result.path].classification,'modified'); assert.equal(f.written.assets['media/source.jpg'].classification,'generated');
});
test('replacement clears stale derivation and binds the new bytes', async () => {
  const f=fixture(); await f.mutate({action:'save',path:'media/source.jpg',sha:sourceSha,content:Buffer.from('new').toString('base64')});
  assert.equal(f.written.assets['media/source.jpg'].classification,'unmarked'); assert.equal(f.written.assets['media/source.jpg'].sourceSha256,metadata.fingerprint('new'));
});
test('stale source, stale metadata, destination collision and concurrent branch update never advance ref', async () => {
  for (const operation of [
    {action:'delete',path:'media/source.jpg',sha:'stale'},
    {action:'classify',path:'media/source.jpg',sha:sourceSha,classification:'modified',revision:'stale'},
    {action:'rename',path:'media/source.jpg',newPath:'media/crop.webp',sha:sourceSha},
  ]) { const f=fixture(); await assert.rejects(f.mutate(operation)); assert.equal(f.updated,false); }
  const f=fixture({conflict:true}); await assert.rejects(f.mutate({action:'delete',path:'media/source.jpg',sha:sourceSha}), (error: any) => error.status===409); assert.equal(f.updated,false);
});
