import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildFixtureEnvironment,
  getPackageManagerInvocation,
  getInheritedSandboxKeys,
  isLocalSandboxDatabaseUrl,
  isPlaceholderValue,
  isValidCryptoKey,
  selectExistingAuthSecret,
  selectExistingCryptoKey,
} from "../scripts/dev-environment.mjs";

test("fixture environment injection is shell-independent", () => {
  assert.deepEqual(buildFixtureEnvironment({ PATH: "test" }), {
    PATH: "test",
    PAGESCMS_FIXTURES_ENABLED: "true",
  });
});

test("authenticated local development rejects inherited sandbox credentials", () => {
  assert.deepEqual(
    getInheritedSandboxKeys({
      BASE_URL: "https://cms.example.com",
      DATABASE_URL: "postgresql://remote/db",
      GITHUB_APP_CLIENT_SECRET: "customer-secret",
      SMTP_PASSWORD: "customer-mail-secret",
      PATH: "/bin",
      EMPTY: "",
    }),
    [
      "BASE_URL",
      "DATABASE_URL",
      "GITHUB_APP_CLIENT_SECRET",
      "SMTP_PASSWORD",
    ],
  );
  assert.deepEqual(getInheritedSandboxKeys({ PATH: "/bin" }), []);
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

test("authenticated local development refuses remote or mismatched databases", () => {
  assert.equal(
    isLocalSandboxDatabaseUrl(
      "postgresql://pagescms:pagescms@localhost:5432/pagescms",
    ),
    true,
  );
  assert.equal(
    isLocalSandboxDatabaseUrl(
      "postgres://pagescms:pagescms@127.0.0.1:55432/pagescms",
      "55432",
    ),
    true,
  );
  assert.equal(
    isLocalSandboxDatabaseUrl(
      "postgresql://pagescms:pagescms@db.example.com:5432/pagescms",
    ),
    false,
  );
  assert.equal(
    isLocalSandboxDatabaseUrl(
      "postgresql://pagescms:pagescms@localhost:55432/pagescms",
    ),
    false,
  );
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

test("GitHub App setup preserves a valid target-file crypto key", () => {
  const targetKey = Buffer.alloc(32, 17).toString("base64");
  const inheritedKey = Buffer.alloc(32, 18).toString("base64");

  assert.equal(selectExistingCryptoKey(targetKey, inheritedKey), targetKey);
  assert.equal(
    selectExistingCryptoKey("random-string-of-characters", inheritedKey),
    inheritedKey,
  );
  assert.equal(
    selectExistingCryptoKey("random-string-of-characters", "invalid"),
    "",
  );
});

test("GitHub App setup also preserves the target file's session secret", () => {
  assert.equal(
    selectExistingAuthSecret("target-secret", "inherited-secret"),
    "target-secret",
  );
  assert.equal(
    selectExistingAuthSecret(
      "random-string-of-characters",
      "inherited-secret",
    ),
    "inherited-secret",
  );
});
