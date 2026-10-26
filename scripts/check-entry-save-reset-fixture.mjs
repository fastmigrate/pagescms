#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.FIXTURE_URL || "http://127.0.0.1:4593/dev/fixtures/entry-save-reset";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const save = page.getByRole("button", { name: "Save", exact: true });
  const title = page.getByLabel("Title", { exact: true });
  const optionalLabels = ["Hours days", "Hours from", "Hours until", "Image description"];
  const savedContent = async () => JSON.parse(await page.getByLabel("Saved content", { exact: true }).textContent());
  const history = async () => JSON.parse(await page.getByLabel("Save history", { exact: true }).textContent());
  const originalNotes = [{ text: "Original note" }];
  const expectedContent = (value, notes = originalNotes) => ({ title: value, notes, controls: { enabled: false, count: 0 } });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await title.waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('button[aria-label="Save"]')?.disabled);
  for (const label of optionalLabels) await page.getByLabel(label, { exact: true }).fill("");
  await save.click();
  await page.getByText("Successful saves: 1", { exact: true }).waitFor();
  assert.deepEqual(await savedContent(), expectedContent("Site settings"));
  try {
    await page.waitForFunction((labels) => labels.every((label) => {
      const input = [...document.querySelectorAll("input")].find((element) => element.id && document.querySelector(`label[for="${element.id}"]`)?.textContent === label);
      return input?.value === "";
    }) && document.querySelector('button[aria-label="Save"]')?.disabled, optionalLabels);
  } finally {
    if (process.env.STATE_IMAGE) await page.screenshot({ path: process.env.STATE_IMAGE, fullPage: true });
  }
  for (const label of optionalLabels) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "");
  assert.equal(await save.isDisabled(), true);
  console.log("PASS: successful save keeps cleared nested fields blank and the editor clean");

  await title.fill("Second save without reload");
  await save.click();
  await page.getByText("Successful saves: 2", { exact: true }).waitFor();
  assert.deepEqual(await savedContent(), expectedContent("Second save without reload"));
  console.log("PASS: another field can be saved without restoring deleted objects or losing false and zero");

  await page.getByRole("button", { name: "Hold next save", exact: true }).click();
  await title.fill("Submitted before response");
  await save.click();
  await page.getByText("Next save held: no. Save pending: yes.", { exact: true }).waitFor();
  await title.fill("Newer unsaved draft");
  await page.getByRole("button", { name: "Release saved response", exact: true }).click();
  await page.getByText("Successful saves: 3", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Save"]')?.disabled);
  assert.equal(await title.inputValue(), "Newer unsaved draft");
  assert.equal(await save.isEnabled(), true);
  assert.deepEqual(await savedContent(), expectedContent("Submitted before response"));
  console.log("PASS: a delayed save preserves newer edits and keeps the next save available");

  await save.click();
  await page.getByText("Successful saves: 4", { exact: true }).waitFor();
  assert.deepEqual(await savedContent(), expectedContent("Newer unsaved draft"));
  await page.waitForFunction(() => document.querySelector('button[aria-label="Save"]')?.disabled);
  console.log("PASS: the next save uses the accepted server revision and persists the newer draft");

  await page.getByRole("button", { name: "Hold next save", exact: true }).click();
  await title.fill("Before list change");
  await save.click();
  await page.getByText("Next save held: no. Save pending: yes.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add an item", exact: true }).click();
  const notes = page.getByLabel("Note", { exact: true });
  await notes.nth(1).waitFor();
  assert.equal(await notes.nth(1).inputValue(), "New note");
  await page.getByRole("button", { name: "Release saved response", exact: true }).click();
  await page.getByText("Successful saves: 5", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Save"]')?.disabled);
  assert.equal(await notes.count(), 2);
  assert.deepEqual(await savedContent(), expectedContent("Before list change"));
  await save.click();
  await page.getByText("Successful saves: 6", { exact: true }).waitFor();
  assert.deepEqual(await savedContent(), expectedContent("Before list change", [...originalNotes, { text: "New note" }]));
  const saves = await history();
  assert.equal(saves.length, 6);
  assert.equal(saves[0].submittedSha, "fixture-file-0");
  for (let index = 1; index < saves.length; index++) {
    assert.equal(saves[index].submittedSha, saves[index - 1].sha);
    assert.notEqual(saves[index].sha, saves[index - 1].sha);
  }
  await page.waitForFunction(() => document.querySelector('button[aria-label="Save"]')?.disabled);
  assert.equal(await title.inputValue(), "Before list change");
  assert.equal(await notes.count(), 2);
  for (const label of optionalLabels) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "");
  assert.deepEqual(errors, []);
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE, fullPage: true });
  console.log("PASS: a list added during a pending save survives the response and the next save stays clean");
  await context.close();
} finally {
  await browser.close();
}
