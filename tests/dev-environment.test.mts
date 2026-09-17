import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildFixtureEnvironment,
  getPackageManagerInvocation,
  isPlaceholderValue,
  isValidCryptoKey,
} from "../scripts/dev-environment.mjs";

test("fixture environment injection is shell-independent", () => {
  assert.deepEqual(buildFixtureEnvironment({ PATH: "test" }), {
    PATH: "test",
    PAGESCMS_FIXTURES_ENABLED: "true",
  });
});

test("local npm commands run through Node and npm_execpath on every platform", () => {
  assert.deepEqual(
    getPackageManagerInvocation({ npm_execpath: "/tools/npm-cli.js" }, "/node"),
    { command: "/node", cli: "/tools/npm-cli.js" },
  );
  assert.throws(
    () => getPackageManagerInvocation({}, "/node"),
    /Missing npm_execpath/u,
  );
});

test("the sandbox database is published on loopback only", async () => {
  const compose = await readFile(new URL("../compose.dev.yml", import.meta.url), "utf8");

  assert.match(compose, /127\.0\.0\.1:\$\{PAGESCMS_POSTGRES_PORT:-5432\}:5432/u);
});

test("local crypto keys must be exact 32-byte standard base64 values", () => {
  const valid = Buffer.alloc(32, 17).toString("base64");

  assert.equal(isValidCryptoKey(valid), true);
  assert.equal(isValidCryptoKey("random-string-of-characters"), false);
  assert.equal(isValidCryptoKey(Buffer.alloc(31, 17).toString("base64")), false);
  assert.equal(isValidCryptoKey(Buffer.alloc(33, 17).toString("base64")), false);
  assert.equal(isValidCryptoKey(valid.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")), false);
  assert.equal(isPlaceholderValue("GITHUB_APP_ID", "your-github-app-id"), true);
  assert.equal(isPlaceholderValue("GITHUB_APP_NAME", "your-cms"), false);
  assert.equal(isPlaceholderValue("GITHUB_APP_PRIVATE_KEY", "configured-xxx-value"), false);
  assert.equal(isPlaceholderValue("GITHUB_APP_CLIENT_ID", "configured-value"), false);
});
