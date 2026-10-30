import assert from "node:assert/strict";
import test from "node:test";
import { cmsGitFixture } from "./helpers/cms-git-fixture.mts";

test("the file API duplicates immutable saved content through normal production transforms", async () => {
  const originalId = "11111111-1111-4111-8111-111111111111";
  const sourceDocument = {
    title: "Original",
    draft: false,
    id: originalId,
    future: { retained: true },
    futureEmptyString: "",
    futureNull: null,
    futureEmptyObject: {},
    futureEmptyArray: [],
    summary: null,
  };
  const schema = {
    name: "jobs",
    type: "collection",
    path: "",
    format: "json",
    extension: "json",
    filename: "{primary}.json",
    operations: {
      create: true,
      duplicate: { field: "title", draft: true },
    },
    view: { primary: "title" },
    fields: [
      { name: "title", type: "string", required: true },
      { name: "draft", type: "boolean" },
      { name: "id", type: "uuid" },
      { name: "summary", type: "string" },
      {
        name: "metadata",
        type: "object",
        fields: [
          { name: "id", type: "uuid" },
          { name: "description", type: "string", required: true },
        ],
      },
    ],
  };

  const f = cmsGitFixture({ content: [schema] }, { "original.json": sourceDocument });
  const response = await f.save("original.json", undefined, { name: "jobs", sha: undefined, duplicate: { value: "Copy" } });
  assert.equal(response.status, 200, await response.text());
  const written = f.json("copy.json");
  assert.equal(written.title, "Copy"); assert.equal(written.draft, true); assert.notEqual(written.id, originalId);
  for (const key of ["future", "futureEmptyString", "futureNull", "futureEmptyObject", "futureEmptyArray"]) assert.deepEqual(written[key], sourceDocument[key as keyof typeof sourceDocument]);
  assert.equal(Object.hasOwn(written, "summary"), false); assert.equal(Object.hasOwn(written, "metadata"), false);
  const conflicting = await f.save("original.json", undefined, { name: "jobs", sha: undefined, duplicate: { value: "Copy" } });
  assert.equal(conflicting.status, 409); assert.match(await conflicting.text(), /already exists/);
  const invalid = cmsGitFixture({ content: [{ ...schema, fields: [{ ...schema.fields[0], pattern: ".{10,}" }, ...schema.fields.slice(1)] }] }, { "original.json": sourceDocument });
  const invalidResponse = await invalid.save("original.json", undefined, { name: "jobs", sha: undefined, duplicate: { value: "Copy" } });
  assert.equal(invalidResponse.status, 400); assert.match(await invalidResponse.text(), /Content validation failed/);
  assert.deepEqual(invalid.mutations, []);
  for (const [root, filename, expected] of [["posts", "news/{primary}.json", "posts/news/copy.json"], ["posts", "../outside/{primary}.json", undefined], ["", "../outside/{primary}.json", undefined]] as const) {
    const path = root ? "posts/news/original.json" : "original.json";
    const nested = cmsGitFixture({ content: [{ ...schema, path: root, filename }] }, { [path]: sourceDocument });
    const response = await nested.save(path, undefined, { name: "jobs", sha: undefined, duplicate: { value: "Copy" } });
    assert.equal(response.status, expected ? 200 : 400, await response.text());
    if (expected) assert(nested.files.has(expected)); else assert.deepEqual(nested.mutations, []);
  }
});
