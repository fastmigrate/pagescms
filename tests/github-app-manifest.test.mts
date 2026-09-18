import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGitHubAppManifest } from "../scripts/github-app-manifest.mjs";

const sourceUrl = new URL("../scripts/setup-github-app.mjs", import.meta.url);

test("uses GitHub's accepted email permission manifest key", async () => {
  const manifest = buildGitHubAppManifest({
    appName: "Pages CMS Test",
    baseUrl: "https://cms.example.com",
    localCallbackUrl: "http://127.0.0.1:8787/api/github-app/callback",
  });

  assert.equal(manifest.default_permissions.emails, "read");
  assert.equal("email_addresses" in manifest.default_permissions, false);
});

test("lets GitHub generate and return the webhook secret", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const manifest = buildGitHubAppManifest({
    appName: "Pages CMS Test",
    baseUrl: "https://cms.example.com",
    localCallbackUrl: "http://127.0.0.1:8787/api/github-app/callback",
  });

  assert.deepEqual(manifest.hook_attributes, {
    url: "https://cms.example.com/api/webhook/github",
    active: true,
  });
  assert.match(
    source,
    /GITHUB_APP_WEBHOOK_SECRET:\s*converted\.webhook_secret\s*\|\|\s*webhookSecret/,
  );
});

test("omits webhook configuration for local loopback base URLs", () => {
  for (const baseUrl of [
    "http://localhost:3310",
    "http://cms.localhost:3310",
    "http://127.0.0.1:3310",
    "http://127.12.34.56:3310",
    "http://[::1]:3310",
  ]) {
    const manifest = buildGitHubAppManifest({
      appName: "Pages CMS Local Test",
      baseUrl,
      localCallbackUrl: "http://127.0.0.1:8787/api/github-app/callback",
    });

    assert.equal("hook_attributes" in manifest, false, baseUrl);
    assert.equal("default_events" in manifest, false, baseUrl);
  }
});

test("preserves target-file secrets and generates a crypto key only as fallback", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /selectExistingCryptoKey\(targetFileCryptoKey, process\.env\.CRYPTO_KEY\)/,
  );
  assert.match(source, /selectExistingAuthSecret\(\s*targetFileAuthSecret,/);
  assert.match(source, /randomBytes\(32\)\.toString\("base64"\)/);
  assert.match(source, /CRYPTO_KEY:\s*cryptoKey/);
});
