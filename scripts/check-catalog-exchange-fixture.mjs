#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.env.FIXTURE_URL || "http://127.0.0.1:4751/dev/fixtures/catalog-exchange";
const expectProtected = process.env.EXPECT_MEDIA_PROTECTED !== "false";
const originalPath = "media/catalogue-october.pdf";
const selectedPath = "media/catalogue-november.pdf";
const uploadedPath = "media/catalogue-december.pdf";
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  const apiRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    apiRequests.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort();
  });
  const saved = page.getByTestId("saved-reference");
  const draft = page.getByTestId("draft-reference");
  const referenceExists = page.getByTestId("saved-reference-exists");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const reset = async () => {
    await page.getByRole("button", { name: "Reset fixture", exact: true }).click();
    await page.getByRole("button", { name: "Remove catalogue-october.pdf", exact: true }).waitFor();
    assert.equal(await saved.textContent(), originalPath);
    assert.equal(await draft.textContent(), originalPath);
    assert.equal(await referenceExists.textContent(), "yes");
  };
  const upload = async () => {
    await page.locator('input[type="file"]').first().setInputFiles({ name: "catalogue-december.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fixture") });
  };
  const remove = async () => {
    await page.getByRole("button", { name: "Remove catalogue-october.pdf", exact: true }).click();
    try {
      await page.waitForFunction(() => document.querySelector('[data-testid="draft-reference"]')?.textContent === "(empty)");
    } catch (error) {
      console.error(await page.locator("main").innerText(), errors, apiRequests);
      throw error;
    }
    assert.equal(await saved.textContent(), originalPath);
    assert.equal(await referenceExists.textContent(), "yes");
    assert.equal(await page.getByTestId("library-asset").count(), 2);
  };

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("button", { name: "Reset fixture", exact: true }).waitFor({ timeout: 90_000 });
  await reset();
  if (process.env.BEFORE_IMAGE) await page.screenshot({ path: process.env.BEFORE_IMAGE, fullPage: true });
  await remove();
  await save.click();
  await page.getByText("This field is required", { exact: true }).waitFor();
  assert.equal(await saved.textContent(), originalPath);
  await page.getByLabel("Fail upload", { exact: true }).check();
  await upload();
  await page.getByText("Upload failed. Existing files are unchanged.", { exact: true }).waitFor();
  assert.equal(await draft.textContent(), "(empty)");
  assert.equal(await referenceExists.textContent(), "yes");
  assert.equal(await page.getByTestId("library-asset").count(), 2);
  await page.getByLabel("Fail upload", { exact: true }).uncheck();
  await upload();
  await page.waitForFunction(path => document.querySelector('[data-testid="draft-reference"]')?.textContent === path, uploadedPath);
  assert.equal(await saved.textContent(), originalPath);
  assert.equal(await referenceExists.textContent(), "yes");
  assert.equal(await page.getByTestId("library-asset").count(), 3);
  await page.getByLabel("Fail save", { exact: true }).check();
  await save.click();
  await page.getByText("Save failed. The saved reference is unchanged.", { exact: true }).waitFor();
  assert.equal(await saved.textContent(), originalPath);
  assert.equal(await draft.textContent(), uploadedPath);
  assert.equal(await referenceExists.textContent(), "yes");
  await page.getByLabel("Fail save", { exact: true }).uncheck();
  await save.click();
  await page.waitForFunction(path => document.querySelector('[data-testid="saved-reference"]')?.textContent === path, uploadedPath);
  assert.equal(await referenceExists.textContent(), "yes");
  assert.equal(await page.getByTestId("library-asset").count(), 3);
  console.log("PASS: Remove changes only the draft; required validation, upload failure, save failure and retry preserve the saved reference and old PDF");

  await reset();
  await remove();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("catalogue-november.pdf", { exact: true }).click();
  await dialog.getByRole("button", { name: "Select", exact: true }).click();
  await page.waitForFunction(path => document.querySelector('[data-testid="draft-reference"]')?.textContent === path, selectedPath);
  assert.equal(await saved.textContent(), originalPath);
  await save.click();
  await page.waitForFunction(path => document.querySelector('[data-testid="saved-reference"]')?.textContent === path, selectedPath);
  assert.equal(await page.getByTestId("library-asset").count(), 2);
  console.log("PASS: selecting an existing PDF changes only the draft until the separate Save boundary");

  await reset();
  await page.getByRole("button", { name: "Options for catalogue-october.pdf", exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  if (expectProtected) {
    assert.equal(await menu.getByRole("menuitem", { name: "Delete", exact: true }).count(), 0);
    assert.equal(await menu.getByRole("menuitem", { name: "Rename", exact: true }).count(), 0);
    console.log("PASS: protected catalogue menu exposes neither physical Delete nor Rename");
  } else {
    assert.equal(await menu.getByRole("menuitem", { name: "Rename", exact: true }).count(), 1);
    await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="saved-reference-exists"]')?.textContent === "no");
    assert.equal(await saved.textContent(), originalPath);
    console.log("BASELINE: physical Delete removes the old PDF immediately and leaves the saved reference missing");
  }
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE, fullPage: true });
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  console.log("PASS: all exercised production components used injected in-memory boundaries without API requests");
  await context.close();
} finally {
  await browser.close();
}
