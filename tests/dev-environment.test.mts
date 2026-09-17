import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFixtureEnvironment,
  isPlaceholderValue,
  isValidCryptoKey,
} from "../scripts/dev-environment.mjs";

test("fixture environment injection is shell-independent", () => {
  assert.deepEqual(buildFixtureEnvironment({ PATH: "test" }), {
    PATH: "test",
    PAGESCMS_FIXTURES_ENABLED: "true",
  });
});

test("local crypto keys must be exact 32-byte standard base64 values", () => {
  const valid = Buffer.alloc(32, 17).toString("base64");

  assert.equal(isValidCryptoKey(valid), true);
  assert.equal(isValidCryptoKey("random-string-of-characters"), false);
  assert.equal(isValidCryptoKey(Buffer.alloc(31, 17).toString("base64")), false);
  assert.equal(isValidCryptoKey(Buffer.alloc(33, 17).toString("base64")), false);
  assert.equal(isValidCryptoKey(valid.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")), false);
  assert.equal(isPlaceholderValue("your-github-app-id"), true);
  assert.equal(isPlaceholderValue("configured-value"), false);
});
