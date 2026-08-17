import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../scripts/setup-github-app.mjs", import.meta.url);

test("uses GitHub's accepted email permission manifest key", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /\bemails:\s*"read"/);
  assert.doesNotMatch(source, /\bemail_addresses:/);
});

test("lets GitHub generate and return the webhook secret", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const hookAttributes = source.match(/hook_attributes:\s*\{(?<body>[\s\S]*?)\n\s*\},/)
    ?.groups?.body;

  assert.ok(hookAttributes, "hook_attributes block is present");
  assert.doesNotMatch(hookAttributes, /\bsecret:/);
  assert.match(
    source,
    /GITHUB_APP_WEBHOOK_SECRET:\s*converted\.webhook_secret\s*\|\|\s*webhookSecret/,
  );
});
