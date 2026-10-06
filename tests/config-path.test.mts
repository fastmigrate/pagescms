import assert from "node:assert/strict";
import test from "node:test";
import { isConfigurationPath } from "../lib/config-path.ts";

const ref = { owner: "fastmigrate", repo: "pagescms", branch: "Review/SEO" };

test("configuration setup accepts mixed-case owner and repository URLs", () => {
  assert.equal(isConfigurationPath("/FastMigrate/PagesCMS/Review%2FSEO/configuration", ref), true);
  assert.equal(isConfigurationPath("/fastmigrate/pagescms/Review%2FSEO/configuration", ref), true);
});

test("configuration setup preserves branch case and the exact route boundary", () => {
  assert.equal(isConfigurationPath("/FastMigrate/PagesCMS/review%2FSEO/configuration", ref), false);
  assert.equal(isConfigurationPath("/FastMigrate/OtherRepo/Review%2FSEO/configuration", ref), false);
  assert.equal(isConfigurationPath("/FastMigrate/PagesCMS/Review%2FSEO/configuration/extra", ref), false);
  assert.equal(isConfigurationPath("/dev/fixtures/configuration", ref), false);
  assert.equal(isConfigurationPath(null, ref), false);
  assert.equal(isConfigurationPath("/FastMigrate/PagesCMS/Review%2FSEO/configuration", null), false);
});
