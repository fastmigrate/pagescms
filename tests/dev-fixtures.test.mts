import assert from "node:assert/strict";
import test from "node:test";

import {
  areDevFixturesEnabled,
  createDuplicateFixtureResponse,
  slugifyFixtureValue,
} from "../lib/dev-fixtures.ts";

test("fixtures require an explicit flag and can never run in production", () => {
  assert.equal(areDevFixturesEnabled({ nodeEnv: "development", enabled: "true" }), true);
  assert.equal(areDevFixturesEnabled({ nodeEnv: "development", enabled: "false" }), false);
  assert.equal(areDevFixturesEnabled({ nodeEnv: "production", enabled: "true" }), false);
});

test("duplicate fixture responses are deterministic drafts without external state", () => {
  const response = createDuplicateFixtureResponse("  Küchenhilfe Köln  ");

  assert.equal(response.status, "success");
  assert.equal(response.data.path, "website/src/content/jobs/kuchenhilfe-koln.json");
  assert.deepEqual(response.data.contentObject, {
    title: "Küchenhilfe Köln",
    draft: true,
    description: "Saved source content remains unchanged in the fixture.",
  });
  assert.equal(slugifyFixtureValue("***"), "");
});
