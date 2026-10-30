#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.FIXTURE_URL || "http://127.0.0.1:4751/dev/fixtures/entry-rename";
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

try {
  for (const scenario of [
    { mode: "object" },
    { mode: "list" },
    { mode: "code" },
    { mode: "object", failRead: true },
    { mode: "object", lateReadFailure: true },
    { mode: "object", download: true },
  ]) {
    const { mode, failRead, lateReadFailure, download } = scenario;
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => { throw new Error(`Unexpected fixture network request ${route.request().url()}`); });
    const save = page.getByRole("button", { name: "Save", exact: true });
    const filename = page.getByLabel("Filename", { exact: true });
    const title = mode === "code" ? page.locator(".cm-content") : page.getByLabel("Title", { exact: true });
    const text = async () => mode === "code" ? title.innerText() : title.inputValue();
    const writes = async () => JSON.parse(await page.getByLabel("Write history", { exact: true }).textContent());
    const saved = async () => JSON.parse(await page.getByLabel("Saved content", { exact: true }).textContent());
    const expected = (title, reference) => mode === "code" ? { body: `${title} ${reference}` }
      : mode === "list" ? [{ title, document: reference }] : { title, document: reference };
    const setText = async (value, reference = "media/missing.pdf") => title.fill(mode === "code" ? `${value} ${reference}` : value);
    const choose = async (name) => {
      const remove = page.getByRole("button", { name: /^Remove .+\.pdf$/ });
      if (await remove.count()) await remove.click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(name, { exact: true }).click();
      await dialog.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByRole("button", { name: `Remove ${name}`, exact: true }).waitFor();
    };

    await page.goto(`${baseUrl}?mode=${mode}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await title.waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => document.querySelector('button[aria-label="Save"]')?.disabled);
    if (failRead || lateReadFailure) await page.getByLabel("Fail destination read", { exact: true }).check();
    await setText("Submitted draft");
    if (mode !== "code") await choose("missing.pdf");
    await page.getByRole("button", { name: "Unlock filename", exact: true }).click();
    const newFilename = `renamed.${mode === "code" ? "md" : "json"}`;
    await filename.fill(newFilename);
    await save.click();
    await page.getByText("Rename pending: yes. Destination read pending: no.", { exact: true }).waitFor();
    assert.equal(await filename.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Lock filename", exact: true }).isDisabled(), true);
    await setText("Newer live draft");
    await page.getByRole("button", { name: "Release rename", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Write history"]').textContent).length === 2);
    const firstWrites = await writes();
    assert.deepEqual(firstWrites.map(({ operation, path, status }) => ({ operation, path, status })), [
      { operation: "rename", path: `content/original.${mode === "code" ? "md" : "json"}`, status: 200 },
      { operation: "save", path: `content/${newFilename}`, status: 409 },
    ]);
    assert.deepEqual(firstWrites[1].body.content, expected("Submitted draft", "media/missing.pdf"));
    assert.equal(await page.getByLabel("Saved path", { exact: true }).textContent(), `content/${newFilename}`);
    assert.equal(await title.count(), 1, "failed content save must keep the mounted editor visible");
    assert.equal(await text(), mode === "code" ? "Newer live draft media/missing.pdf" : "Newer live draft");
    assert.equal(await filename.inputValue(), newFilename);
    assert.equal(await filename.isDisabled(), true);
    assert.equal(await page.getByLabel("Navigation target", { exact: true }).textContent(), "");
    if (mode !== "code") assert.equal(await page.getByRole("button", { name: "Remove missing.pdf", exact: true }).count(), 1);
    if (failRead) {
      await page.getByRole("button", { name: "Release destination read", exact: true }).click();
      await page.getByText("Rename pending: no. Destination read pending: no.", { exact: true }).waitFor();
      assert.equal(await page.getByText("Something went wrong", { exact: true }).count(), 0);
      assert.equal(await text(), "Newer live draft");
    }

    if (download) {
      await page.getByRole("button", { name: "Publish configuration update", exact: true }).click();
      await page.getByRole("button", { name: "Download draft and update fields", exact: true }).waitFor();
      const pendingDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download draft and update fields", exact: true }).click();
      const result = await pendingDownload;
      assert.deepEqual(JSON.parse(await readFile(await result.path(), "utf8")), {
        title: "Newer live draft", document: "media/missing.pdf", _filename: newFilename,
      });
      console.log("PASS: failed rename Save retains all current draft values and filename in the recovery download");
    } else {
      await setText("Newer live draft", "media/replacement.pdf");
      if (mode !== "code") await choose("replacement.pdf");
      await save.click();
      await page.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Write history"]').textContent).length === 3);
      const allWrites = await writes();
      assert.equal(allWrites[2].operation, "save");
      assert.equal(allWrites[2].path, `content/${newFilename}`);
      assert.equal(allWrites[2].body.sha, "fixture-file-0");
      assert.equal(allWrites[2].status, 200);
      assert.deepEqual(allWrites[2].body.content, expected("Newer live draft", "media/replacement.pdf"));
      assert.deepEqual(await saved(), expected("Newer live draft", "media/replacement.pdf"));
      await page.getByLabel("Navigation target", { exact: true }).filter({ hasText: encodeURIComponent(`content/${newFilename}`) }).waitFor();
      if (!failRead) {
        await page.getByRole("button", { name: "Release destination read", exact: true }).click();
        await page.getByText("Rename pending: no. Destination read pending: no.", { exact: true }).waitFor();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      assert.equal(await page.getByText("Something went wrong", { exact: true }).count(), 0);
      assert.equal(await text(), mode === "code" ? "Newer live draft media/replacement.pdf" : "Newer live draft");
      await page.waitForFunction(() => document.querySelector('button[aria-label="Save"]')?.disabled);
      console.log(`PASS: ${mode}${lateReadFailure ? " with late failed destination read" : failRead ? " with failed destination read" : " with stale delayed destination read"} retains live edits after 409 and retries only the actual renamed path`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
