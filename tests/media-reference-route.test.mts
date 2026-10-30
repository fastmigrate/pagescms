import assert from "node:assert/strict";
import test from "node:test";
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";

const current = "public/media/current.pdf";
const unused = "public/media/unused.pdf";
const missing = "public/media/missing.pdf";
const document = "data/settings.json";
const config = {
  media: [{ name: "assets", input: "public/media", output: "/media" }],
  content: [{ name: "settings", label: "Website settings", type: "file", path: document, fields: [{ name: "catalogue", label: "Catalogue", type: "file" }] }],
};
const fixture = (settings: unknown = { catalogue: "/media/current.pdf" }, extraConfig: Record<string, any> = {}, extraFiles: Record<string, any> = {}) => cmsGitFixture({ ...config, ...extraConfig }, {
  [current]: "%PDF current", [unused]: "%PDF unused", [document]: settings, ...extraFiles,
});
const body = async (response: Response) => ({ ...(await response.json()), status: response.status });

for (const action of ["remove", "rename"] as const) {
  test(`referenced ${action} refuses with saved entry and field before any Git objects`, async () => {
    const f = fixture();
    const result = await body(await (action === "remove" ? f.remove(current) : f.rename(current, "public/media/renamed.pdf")));
    assert.equal(result.status, 409);
    assert.match(result.message, /Website settings > Catalogue/);
    assert.match(result.message, /current.pdf.*still used/);
    assert.match(result.message, /replacement.*save.*try again/);
    assert.doesNotMatch(result.message, /data\/|public\/|GitHub|SHA|final tree/);
    assert(f.files.has(current)); assert.deepEqual(f.mutations, []);
  });
  test(`unused ${action} succeeds and keeps the saved reference intact`, async () => {
    const f = fixture();
    const next = "public/media/renamed.pdf";
    const result = await (action === "remove" ? f.remove(unused) : f.rename(unused, next));
    assert.equal(result.status, 200, await result.text());
    assert(!f.files.has(unused)); assert(f.files.has(current));
    assert.equal(f.files.has(next), action === "rename"); assert.equal(f.published(), 1);
  });
}

test("saving a replacement permits old-file cleanup; an unsaved draft does not", async () => {
  const f = fixture();
  const draft = { catalogue: unused };
  assert.equal((await f.remove(current)).status, 409);
  assert.equal((await f.save(document, draft)).status, 200);
  assert.deepEqual(f.json(document), { catalogue: "/media/unused.pdf" });
  assert.equal((await f.remove(current)).status, 200);
  assert.equal((await f.remove(unused)).status, 409);
});

test("missing and stale content Save preserve the previous saved document", async () => {
  const f = fixture();
  const original = f.text(document);
  for (const input of [{ catalogue: missing }, { catalogue: [missing] }]) {
    const result = await body(await f.save(document, input));
    assert(result.status >= 400 && result.status < 500);
    if (typeof input.catalogue === "string") {
      assert.equal(result.status, 409);
      assert.match(result.message, /missing.pdf.*unavailable.*Website settings > Catalogue/);
      assert.match(result.message, /Select or upload a replacement.*try again/);
      assert.doesNotMatch(result.message, /data\/|public\/|final tree|Cannot save/);
    }
    assert.equal(f.text(document), original); assert.deepEqual(f.mutations, []);
  }
  const sha = f.files.get(document)!.sha;
  f.externalCommit({ [document]: { catalogue: "/media/unused.pdf" } });
  const result = await f.save(document, { catalogue: current }, { sha });
  assert.equal(result.status, 409); assert.deepEqual(f.mutations, []);
});

for (const first of ["save", "delete"] as const) {
  test(`two writers ${first} first publish only one plan; retry checks the fresh branch`, { timeout: 10_000 }, async () => {
    const f = fixture();
    const sourceSha = f.files.get(document)!.sha;
    f.holdUpdates();
    const save = f.save(document, { catalogue: unused });
    await f.waitForUpdates(1);
    const remove = f.remove(unused);
    await f.waitForUpdates(2);
    f.releaseUpdate(first === "save" ? 0 : 1);
    const winner = first === "save" ? await save : await remove;
    assert.equal(winner.status, 200);
    f.releaseUpdate(first === "save" ? 1 : 0);
    const loser = first === "save" ? await remove : await save;
    assert.equal(loser.status, 409);
    f.stopHoldingUpdates();
    if (first === "save") {
      assert.equal((await f.remove(unused)).status, 409); assert(f.files.has(unused));
    } else {
      assert.equal(f.files.get(document)!.sha, sourceSha);
      const retry = await body(await f.save(document, { catalogue: unused }, { sha: sourceSha }));
      assert.equal(retry.status, 409); assert.match(retry.message, /Catalogue/); assert(!f.files.has(unused));
    }
    assert.equal(f.published(), 1);
  });
}

test("a configuration advance and newly saved draft defeat a stale deletion; retry finds the new use", { timeout: 10_000 }, async () => {
  const f = fixture();
  const originalConfigSha = f.sha;
  f.holdUpdates();
  const remove = f.remove(unused);
  await f.waitForUpdates(1);
  f.externalCommit({ ".pages.yml": { ...config, content: [...config.content, { name: "drafts", type: "collection", path: "drafts", fields: [{ name: "file", type: "file" }] }] }, "drafts/new.md": "---\nfile: /media/unused.pdf\ndraft: true\n---\n" });
  f.releaseUpdate(0);
  assert.equal((await remove).status, 409);
  f.stopHoldingUpdates();
  const retry = await body(await f.remove(unused)); assert.equal(retry.status, 409); assert.match(retry.message, /Drafts > New > File/);
  assert.equal((await f.save(document, { catalogue: current }, { configSha: originalConfigSha })).status, 409);
});

test("nested, hidden, list, block and root-list drafts contribute indexed typed uses", async () => {
  const fields = [{ name: "hidden", type: "object", hidden: true, fields: [{ name: "files", type: "file", list: true }] }, {
    name: "blocks", type: "block", list: true, blockKey: "kind", blocks: [{ name: "download", fields: [{ name: "files", type: "image", options: { multiple: true } }] }],
  }];
  const value = { draft: true, hidden: { files: ["/media/unused.pdf"] }, blocks: [{ kind: "download", files: ["/media/unused.pdf"] }] };
  const f = fixture({}, { content: [{ name: "group", type: "group", items: [{ name: "drafts", type: "collection", path: "drafts", extension: "json", format: "json", list: true, fields }] }] }, { "drafts/a.json": [value] });
  const result = await body(await f.remove(unused));
  assert.equal(result.status, 409); assert.match(result.message, /Drafts > A > Files, item 1, item 1/); assert.match(result.message, /Files, item 1, item 1, item 1/);
  assert.deepEqual(f.mutations, []);
});

test("a content alias cannot remove or rename a referenced media path", async () => {
  const f = fixture(undefined, { content: [...config.content, { name: "alias", type: "collection", path: "public", extension: "pdf" }] });
  for (const response of [await f.remove(current, { type: "content", name: "alias" }), await f.rename(current, "public/media/other.pdf", { type: "content", name: "alias" })]) assert.equal(response.status, 409);
  assert.deepEqual(f.mutations, []);
});

test("a media upload and its collision destination cannot introduce missing configured content", async () => {
  const f = fixture(undefined, { media: [{ name: "assets", input: "", output: "/" }], content: [...config.content, { name: "collision", type: "file", path: "data/settings-1.json", fields: [{ name: "catalogue", label: "Catalogue", type: "file" }] }] });
  const result = await body(await f.save(document, Buffer.from(JSON.stringify({ catalogue: "/missing.pdf" })).toString("base64"), { type: "media", name: "assets", sha: undefined }));
  assert.equal(result.status, 409); assert.match(result.message, /Collision > Catalogue/); assert.deepEqual(f.mutations, []);
});

test("unrelated existing missing references do not prevent cleanup of an unused asset", async () => {
  const f = fixture({ catalogue: "/media/missing.pdf" });
  assert.equal((await f.remove(unused)).status, 200);
});

for (const failure of ["truncated", "read", "incomplete", "malformed", "list", "block"] as const) {
  test(`${failure} relevant state refuses deletion without publication`, async () => {
    const f = failure === "list" ? fixture({ rows: "wrong" }, { content: [{ ...config.content[0], fields: [{ name: "rows", type: "object", list: true, fields: [{ name: "file", type: "file" }] }] }] })
      : failure === "block" ? fixture({ rows: [{ kind: "unknown", file: "/media/unused.pdf" }] }, { content: [{ ...config.content[0], fields: [{ name: "rows", type: "block", list: true, blockKey: "kind", blocks: [{ name: "known", fields: [{ name: "file", type: "file" }] }] }] }] })
      : failure === "malformed" ? fixture("{bad JSON") : fixture();
    if (failure === "truncated") f.truncated = true;
    if (failure === "read") f.brokenBlob = f.files.get(document)!.sha;
    if (failure === "incomplete") f.incompleteBlob = f.files.get(document)!.sha;
    const response = await f.remove(unused);
    assert(response.status >= 400); assert.deepEqual(f.mutations, []); assert(f.files.has(unused));
  });
}

test("normal route session, repository permission and same-origin decisions remain authoritative", async () => {
  const f = fixture();
  assert.equal((await f.remove(unused, {}, "https://elsewhere.test")).status, 403);
  f.signedIn = false; assert.equal((await f.remove(unused)).status, 401);
  f.signedIn = true; f.allowed = false; assert.equal((await f.remove(unused)).status, 403);
  assert.deepEqual(f.mutations, []);
});

test("metadata-enabled content aliases keep provenance and references in one guarded commit", async () => {
  const f = fixture(undefined, { mediaMetadata: "data/media.json", content: [...config.content, { name: "alias", type: "collection", path: "public", extension: "pdf" }] }, { "data/media.json": { version: 1, assets: {}, future: { keep: null } } });
  assert.equal((await f.remove(current, { type: "content", name: "alias" })).status, 409); assert.deepEqual(f.mutations, []);
  assert.equal((await f.rename(unused, "public/media/renamed.pdf", { type: "content", name: "alias" })).status, 200);
  assert.deepEqual(f.json("data/media.json"), { version: 1, assets: {}, future: { keep: null } });
  const tree = f.mutations.find(item => item.method === "createTree")!;
  assert.equal(tree.tree.length, 3); assert.equal(f.published(), 1);
});

test("rename requires the loaded source SHA, rejects occupied destinations and preserves executable mode", async () => {
  const f = fixture();
  assert.equal((await f.rename(unused, "public/media/new.pdf", { sha: undefined })).status, 400);
  assert.equal((await f.rename(unused, current)).status, 409);
  assert.equal((await f.rename(unused, "public/media/new.pdf", { sha: "stale" })).status, 409);
  assert.deepEqual(f.mutations, []);
  f.files.get(unused)!.mode = "100755";
  f.externalCommit({});
  assert.equal((await f.rename(unused, "public/media/new.pdf")).status, 200);
  assert.equal(f.files.get("public/media/new.pdf")!.mode, "100755");
});

test("a cache failure after publication still returns a successful save", async () => {
  const f = fixture(); f.cacheFailure = true;
  assert.equal((await f.save(document, { catalogue: unused })).status, 200);
  assert.deepEqual(f.json(document), { catalogue: "/media/unused.pdf" }); assert.equal(f.published(), 1);
});

test("Save validates final merge bytes and references preserved by duplicate from the immutable source", async () => {
  const fields = [{ name: "title", type: "string", required: true }, { name: "catalogue", label: "Catalogue", type: "file" }];
  const merged = fixture({ title: "Saved", catalogue: "/media/missing.pdf" }, { settings: { content: { merge: true } }, content: [{ ...config.content[0], fields }] });
  const result = await body(await merged.save(document, { title: "Edited", catalogue: missing }));
  assert.equal(result.status, 409); assert.match(result.message, /Catalogue/); assert.deepEqual(merged.mutations, []);
  const duplicate = fixture({}, { content: [{ name: "drafts", type: "collection", path: "drafts", filename: "{primary}.json", operations: { duplicate: true }, fields }] }, { "drafts/original.json": { title: "Original", catalogue: "/media/missing.pdf", future: null } });
  assert.equal((await duplicate.save("drafts/original.json", undefined, { name: "drafts", sha: undefined, duplicate: { value: "Copy" } })).status, 409);
  assert.deepEqual(duplicate.mutations, []);
});

test("renaming an unused structured content alias checks the final saved bytes", async () => {
  const f = fixture({}, { media: [{ name: "assets", input: "", output: "/" }], content: [config.content[0]] }, { "upload.json": { catalogue: "/missing.pdf" } });
  const result = await body(await f.rename("upload.json", document, { type: "media", sha: f.files.get("upload.json")!.sha }));
  assert.equal(result.status, 409); assert.deepEqual(f.mutations, []);
  f.externalCommit({ [document]: undefined });
  const final = await body(await f.rename("upload.json", document));
  assert.equal(final.status, 409); assert.match(final.message, /Catalogue/); assert.deepEqual(f.mutations, []);
});

test("Rename wins against a stale Save; retry refuses the missing old target without changing the draft file", { timeout: 10_000 }, async () => {
  const f = fixture();
  const loadedContentSha = f.files.get(document)!.sha;
  const destination = "public/media/renamed.pdf";
  f.holdUpdates();
  const rename = f.rename(unused, destination);
  await f.waitForUpdates(1);
  const save = f.save(document, { catalogue: unused }, { sha: loadedContentSha });
  await f.waitForUpdates(2);
  f.releaseUpdate(0);
  assert.equal((await rename).status, 200);
  f.releaseUpdate(1);
  assert.equal((await save).status, 409);
  assert.equal(f.files.get(document)!.sha, loadedContentSha);
  assert(f.files.has(destination)); assert(!f.files.has(unused));
  f.stopHoldingUpdates();
  const retry = await body(await f.save(document, { catalogue: unused }, { sha: loadedContentSha }));
  assert.equal(retry.status, 409); assert.match(retry.message, /Catalogue/);
  assert.deepEqual(f.json(document), { catalogue: "/media/current.pdf" }); assert.equal(f.published(), 1);
});

test("literal percent filenames save as references, protect used assets and permit unrelated unused cleanup", async () => {
  const percent = "public/media/catalogue-100%.pdf";
  const f = fixture(undefined, {}, { [percent]: "%PDF literal percent" });
  assert.equal((await f.save(document, { catalogue: percent })).status, 200);
  assert.deepEqual(f.json(document), { catalogue: "/media/catalogue-100%.pdf" });
  assert.equal((await f.remove(percent)).status, 409);
  assert.equal((await f.rename(percent, "public/media/renamed.pdf")).status, 409);
  assert.equal((await f.remove(unused)).status, 200);
  assert(f.files.has(percent));
});
