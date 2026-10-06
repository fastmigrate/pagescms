#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.FIXTURE_URL || "http://127.0.0.1:3118/dev/fixtures/configuration";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(baseUrl);
  await page.getByLabel("Title", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Publish SEO title configuration" }).click();
  await page.clock.runFor(60_100);
  await page.getByLabel("SEO title", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("SEO title", { exact: true }).inputValue(), "Aries and Taurus compatibility");
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE, fullPage: true });
  console.log("PASS: clean open editor loads new fields automatically after polling");

  await page.reload();
  await page.getByLabel("Title", { exact: true }).fill("My unsaved draft");
  await page.getByRole("button", { name: "Publish SEO title configuration" }).click();
  await page.getByRole("button", { name: "Check configuration", exact: true }).click();
  await page.getByRole("status").waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "My unsaved draft");
  assert.equal(await page.getByLabel("SEO title", { exact: true }).count(), 0);
  console.log("PASS: changed configuration keeps dirty form and its values");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download draft and update fields" }).click();
  const download = await downloadPromise;
  const draft = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(draft.title, "My unsaved draft");
  await page.getByLabel("SEO title", { exact: true }).waitFor();
  assert.equal(await page.getByRole("status").count(), 0);
  console.log("PASS: draft download contains unsaved text before new fields load");
  await page.reload();
  await page.getByRole("button", { name: "Use full entry editor" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved full editor draft");
  await page.clock.runFor(3_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(100);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved full editor draft");
  await page.getByRole("button", { name: "Publish SEO title configuration" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("status").waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved full editor draft");
  await page.getByText("Successful saves: 0").waitFor();
  console.log("PASS: actual entry keeps drafts during background reads and rejected stale saves");

  await page.reload();
  await page.getByRole("button", { name: "Use full entry editor" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved full editor draft");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Successful saves: 1").waitFor();
  await page.getByRole("button", { name: "Publish SEO title configuration" }).click();
  await page.clock.runFor(60_100);
  await page.getByLabel("SEO title", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Saved full editor draft");
  console.log("PASS: successful save releases the update lock and retains saved content");
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
}
