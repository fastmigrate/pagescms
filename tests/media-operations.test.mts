import assert from "node:assert/strict";
import test from "node:test";
import { productionLoader } from "./helpers/cms-git-fixture.mts";

const load = productionLoader();
const { ConfigSchema } = load("lib/config-schema.ts");
const { normalizeConfig } = load("lib/config.ts");
const { isContentOperationAllowed } = load("lib/operations.ts");
const { getUploadFileName } = load("lib/utils/file.ts");

test("media sources use reference protection without unpublished directory restriction flags", () => {
  const source = { name: "catalogues", input: "public/catalogues", output: "/downloads", rename: "safe" };
  assert.equal(ConfigSchema.safeParse({ media: [source] }).success, true);
  assert.equal(ConfigSchema.safeParse({ media: [{ ...source, operations: { delete: false, rename: false } }] }).success, false);
  const normalized = normalizeConfig({ media: [source] });
  assert.equal(normalized.media[0].rename, "safe");
  assert.equal(getUploadFileName("My Catalogue.PDF", normalized.media[0].rename), "my-catalogue.pdf");
});

test("established content operation permissions remain independent", () => {
  const schema = { type: "collection", operations: { delete: false, rename: false, duplicate: true } };
  assert.equal(isContentOperationAllowed("delete", { schema }), false);
  assert.equal(isContentOperationAllowed("rename", { schema }), false);
  assert.equal(isContentOperationAllowed("duplicate", { schema }), true);
  assert.equal(isContentOperationAllowed("delete", { scope: "settings" }), false);
});
