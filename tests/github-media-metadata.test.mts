import assert from "node:assert/strict";
import test from "node:test";
import * as metadata from "../lib/media-metadata.ts";
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";

function fixture({ conflict = false, large = false, truncated = false, omittedSource = false } = {}) {
  const f = cmsGitFixture({ mediaMetadata: "data/media.json", media: [{ name: "assets", input: "media", output: "/media" }] }, { "media/source.jpg": "image", "media/crop.webp": "crop" });
  const document = { version: 1, assets: {
    "media/source.jpg": { classification: "generated", sourceSha256: metadata.fingerprint("image"), sourceGitSha: f.files.get("media/source.jpg")!.sha, future: null },
    "media/crop.webp": { classification: "modified", sourceSha256: metadata.fingerprint("crop"), sourceGitSha: f.files.get("media/crop.webp")!.sha },
  }, unknown: { nested: [null, ""] } };
  const persist = () => f.externalCommit({ "data/media.json": document });
  persist();
  const helper = f.load("lib/github-media-metadata.ts");
  return {
    ...f, document, files: f.files,
    mutate: async (operation: any) => {
      persist();
      f.truncated = truncated;
      if (conflict) {
        f.holdUpdates();
        const pending = f.mutateMetadata(operation);
        await f.waitForUpdates(1); f.externalCommit({ "unrelated.txt": "advance" }); f.releaseUpdate(0);
        return pending;
      }
      return f.mutateMetadata(operation);
    },
    read: async () => { persist(); f.omitInline = large; return helper.readMediaMetadata("test", { owner: "fixture", repo: "private", branch: "main" }, "data/media.json"); },
    status: async () => { persist(); f.truncated = truncated; if (omittedSource) f.externalCommit({ "media/source.jpg": undefined }); return helper.readMediaMetadataStatus("test", { owner: "fixture", repo: "private", branch: "main" }, "data/media.json"); },
    get written() { return f.mutations.some(item => item.method === "createBlob") ? f.json("data/media.json") : undefined; },
    get delta() { return f.mutations.find(item => item.method === "createTree"); },
    get updated() { return f.published() > 0; },
  };
}
test('rename and metadata share one base-tree commit and preserve unknown fields', async () => {
  const f = fixture(); await f.mutate({action:'rename',path:'media/source.jpg',newPath:'media/new.jpg',sha:f.files.get("media/source.jpg")!.sha});
  assert.equal(f.updated,true); assert.ok(f.delta.base_tree); assert.equal(f.delta.tree.length,3);
  assert.deepEqual(f.written.assets['media/crop.webp'],f.document.assets['media/crop.webp']); assert.equal(f.written.assets['media/new.jpg'].future,null); assert.deepEqual(f.written.unknown,{nested:[null,'']});
});
test('collision name is chosen before saving its metadata', async () => {
  const f = fixture(); const result = await f.mutate({action:'save',path:'media/source.jpg',content:Buffer.from('new').toString('base64'),classification:'modified'});
  assert.equal(result.path,'media/source-1.jpg'); assert.equal(f.written.assets[result.path].classification,'modified'); assert.equal(f.written.assets['media/source.jpg'].classification,'generated');
});
test('replacement binds new bytes without changing other originals', async () => {
  const f=fixture(); await f.mutate({action:'save',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha,revision:metadata.recordRevision(f.document.assets["media/source.jpg"]),content:Buffer.from('new').toString('base64')});
  assert.deepEqual(f.written.assets['media/crop.webp'],f.document.assets['media/crop.webp']);
  assert.equal(f.written.assets['media/source.jpg'].classification,'unmarked'); assert.equal(f.written.assets['media/source.jpg'].sourceSha256,metadata.fingerprint('new'));
});
test('stale source, stale metadata, destination collision and concurrent branch update never advance ref', async () => {
  for (const operation of [
    {action:'delete',path:'media/source.jpg',sha:'stale'},
    {action:'classify',path:'media/source.jpg',sha:'stale',classification:'modified',revision:'stale'},
    {action:'rename',path:'media/source.jpg',newPath:'media/crop.webp',sha:'stale'},
  ]) { const f=fixture(); await assert.rejects(f.mutate(operation)); assert.equal(f.updated,false); }
  const f=fixture({conflict:true}); await assert.rejects(f.mutate({action:'delete',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha}), (error: any) => error.status===409); assert.equal(f.updated,false);
});

test('classification requires an explicit valid choice and refuses manual variant requests', async () => {
  for (const selection of [{}, {classification:'invalid'}, {derivedFrom:'media/source.jpg'}, {classification:'generated',derivedFrom:'media/source.jpg'}]) {
    const f=fixture();
    await assert.rejects(f.mutate({action:'classify',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha,revision:metadata.recordRevision(f.document.assets['media/source.jpg']),...selection}), (error: any) => error.status===400);
    assert.equal(f.updated,false);
  }
});

test('replacement rejects stale metadata even when the source blob is unchanged', async () => {
 const f=fixture();await assert.rejects(f.mutate({action:'save',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha,revision:'stale',content:Buffer.from('new').toString('base64')}),(error: any)=>error.status===409);assert.equal(f.updated,false);
});
test('collision allocation reserves orphan metadata paths', async () => {
 const f=fixture();(f.document.assets as any)['media/source-1.jpg']={classification:'modified',sourceSha256:metadata.fingerprint('old'),future:'old owner'};
 const result=await f.mutate({action:'save',path:'media/source.jpg',content:Buffer.from('new').toString('base64')});assert.equal(result.path,'media/source-2.jpg');assert.equal(f.written.assets[result.path].future,undefined);
});
test('large metadata reads use Git blobs when Contents omits inline bytes',async()=>{const f=fixture({large:true});assert.deepEqual(await f.read(),f.document);});
test('reviewing externally replaced bytes changes only its own classification', async () => {
 const f=fixture();f.document.assets['media/source.jpg'].sourceSha256=metadata.fingerprint('old bytes');
 await f.mutate({action:'classify',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha,revision:metadata.recordRevision(f.document.assets['media/source.jpg']),classification:'modified'});
 assert.equal(f.written.assets['media/source.jpg'].classification,'modified');
 assert.deepEqual(f.written.assets['media/crop.webp'],f.document.assets['media/crop.webp']);
});
test('renaming to an unsupported extension removes only its own record', async () => {
 const f=fixture();await f.mutate({action:'rename',path:'media/source.jpg',newPath:'media/source.gif',sha:f.files.get("media/source.jpg")!.sha});
 assert.equal(f.written.assets['media/source.gif'],undefined);assert.equal(f.written.assets['media/source.jpg'],undefined);
 assert.deepEqual(f.written.assets['media/crop.webp'],f.document.assets['media/crop.webp']);
 assert(f.delta.tree.some((entry:any)=>entry.path==='media/source.gif' && entry.sha===f.document.assets['media/source.jpg'].sourceGitSha));
});

test('listing trust checks each original independently against fresh Git fingerprints', async () => {
 const f=fixture();
 f.document.assets['media/source.jpg'].sourceGitSha=f.files.get("media/source.jpg")!.sha;
 f.document.assets['media/crop.webp'].sourceGitSha=f.files.get("media/crop.webp")!.sha;
 assert.equal((await f.status()).stale.get('media/crop.webp'),false);
 delete f.document.assets['media/source.jpg'].sourceGitSha;
 const unverifiable=await f.status();assert.equal(unverifiable.stale.get('media/source.jpg'),true);assert.equal(unverifiable.stale.get('media/crop.webp'),false);
 f.document.assets['media/source.jpg'].sourceGitSha='e'.repeat(40);
 assert.equal((await f.status()).stale.get('media/source.jpg'),true);assert.equal((await f.status()).stale.get('media/crop.webp'),false);
});

test('truncated Git listings trust matching returned sources but not omitted or changed sources', async () => {
 const f=fixture({truncated:true});
 const matching=await f.status();assert.equal(matching.stale.get('media/source.jpg'),false);assert.equal(matching.stale.get('media/crop.webp'),false);
 f.document.assets['media/source.jpg'].sourceGitSha='e'.repeat(40);
 assert.equal((await f.status()).stale.get('media/source.jpg'),true);
 const omitted=await fixture({truncated:true,omittedSource:true}).status();
 assert.equal(omitted.stale.get('media/source.jpg'),true);assert.equal(omitted.stale.get('media/crop.webp'),false);
});

test('deleting an original preserves unrelated records and unknown fields', async () => {
 const f=fixture();await f.mutate({action:'delete',path:'media/source.jpg',sha:f.files.get("media/source.jpg")!.sha});
 assert.equal(f.written.assets['media/source.jpg'],undefined);
 assert.deepEqual(f.written.assets['media/crop.webp'],f.document.assets['media/crop.webp']);
 assert.deepEqual(f.written.unknown,f.document.unknown);
});

test('upload and replacement operations reject manual relationships before Git writes', async () => {
 for(const existing of [false, true]) {
  const f=fixture(); const sha = existing ? f.files.get("media/source.jpg")!.sha : undefined;await assert.rejects(f.mutate({action:'save',path:'media/source.jpg',sha,revision:metadata.recordRevision(f.document.assets['media/source.jpg']),content:Buffer.from('new').toString('base64'),classification:'generated',derivedFrom:'media/crop.webp'}),(error:any)=>error.status===400);
  assert.equal(f.updated,false);assert.equal(f.written,undefined);assert.equal(f.delta,undefined);
 }
});
