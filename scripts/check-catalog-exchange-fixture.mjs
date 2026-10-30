#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.env.FIXTURE_URL || "http://127.0.0.1:4751/dev/fixtures/catalog-exchange";
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
  const unexpectedRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const match = new URL(request.url()).pathname.match(/^\/api\/fixture\/catalogue\/main\/files\/(.+)\/rename$/);
    if (request.method() !== "POST" || !match) {
      unexpectedRequests.push(`${request.method()} ${request.url()}`);
      await route.abort();
      return;
    }
    const path = decodeURIComponent(match[1]);
    const data = request.postDataJSON();
    assert.equal(data.type, "media");
    assert.equal(data.name, "catalogues");
    assert.ok(data.sha);
    const used = await page.getByTestId("saved-reference").textContent() === path;
    apiRequests.push({ path, newPath: data.newPath, used });
    await route.fulfill({
      status: used ? 409 : 200,
      contentType: "application/json",
      body: JSON.stringify(used
        ? { status: "error", message: "This file is used by Website settings / Catalogue (data/settings.json, catalogue). Save a replacement before deleting or renaming it." }
        : { status: "success", message: "File renamed.", data: { path, newPath: data.newPath } }),
    });
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
  const deleteAsset = async name => {
    await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  };
  const renameAsset = async (name, newName) => {
    const requestCount = apiRequests.length;
    await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(newName);
    const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/rename"));
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await response;
    await dialog.waitFor({ state: "hidden" });
    assert.equal(apiRequests.length, requestCount + 1);
  };
  const selectExisting = async () => {
    await remove();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("catalogue-november.pdf", { exact: true }).click();
    await dialog.getByRole("button", { name: "Select", exact: true }).click();
    await page.waitForFunction(path => document.querySelector('[data-testid="draft-reference"]')?.textContent === path, selectedPath);
  };
  const expectUsedMessage = async () => {
    await page.getByText(/This file is used by Website settings \/ Catalogue/).first().waitFor();
    assert.equal(await saved.textContent(), originalPath);
    assert.equal(await referenceExists.textContent(), "yes");
    assert.equal(await page.getByTestId("library-asset").count(), 2);
  };

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('main[data-fixture-ready="true"]').waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Reset fixture", exact: true }).waitFor({ timeout: 90_000 });
  await reset();
  if (process.env.BEFORE_IMAGE) await page.screenshot({ path: process.env.BEFORE_IMAGE, fullPage: true });
  await remove();
  await save.click();
  await page.getByText("This field is required", { exact: true }).waitFor();
  assert.equal(await saved.textContent(), originalPath);
  await page.getByLabel("Fail upload", { exact: true }).check();
  await upload();
  await page.getByText("Upload failed. Existing files are unchanged.", { exact: true }).first().waitFor();
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
  await selectExisting();
  assert.equal(await saved.textContent(), originalPath);
  await save.click();
  await page.waitForFunction(path => document.querySelector('[data-testid="saved-reference"]')?.textContent === path, selectedPath);
  assert.equal(await page.getByTestId("library-asset").count(), 2);
  console.log("PASS: selecting an existing PDF changes only the draft until the separate Save boundary");
  await deleteAsset("catalogue-october.pdf");
  await page.getByRole("button", { name: "Options for catalogue-october.pdf", exact: true }).waitFor({ state: "detached" });
  assert.equal(await saved.textContent(), selectedPath);
  assert.equal(await referenceExists.textContent(), "yes");
  assert.equal(await page.getByTestId("library-asset").count(), 1);
  console.log("PASS: saving a replacement permits deleting the previous catalogue");

  await reset();
  await deleteAsset("catalogue-october.pdf");
  await expectUsedMessage();
  await renameAsset("catalogue-october.pdf", "catalogue-renamed.pdf");
  await expectUsedMessage();
  assert.equal(apiRequests.at(-1).used, true);
  await remove();
  await deleteAsset("catalogue-october.pdf");
  await expectUsedMessage();
  assert.equal(await draft.textContent(), "(empty)");
  console.log("PASS: referenced Delete and Rename show the referring entry and field; unsaved Remove preserves protection and the draft");

  await reset();
  await page.getByLabel("Fail delete", { exact: true }).check();
  await deleteAsset("catalogue-november.pdf");
  await page.getByText("Delete failed. Existing files are unchanged.", { exact: true }).first().waitFor();
  assert.equal(await page.getByTestId("library-asset").count(), 2);
  await page.getByLabel("Fail delete", { exact: true }).uncheck();
  await deleteAsset("catalogue-november.pdf");
  await page.getByRole("button", { name: "Options for catalogue-november.pdf", exact: true }).waitFor({ state: "detached" });
  assert.equal(await referenceExists.textContent(), "yes");
  console.log("PASS: unused Delete stays available and a failed attempt is retryable");

  await reset();
  await renameAsset("catalogue-november.pdf", "catalogue-next.pdf");
  await page.getByRole("button", { name: "Options for catalogue-next.pdf", exact: true }).waitFor();
  assert.equal(apiRequests.at(-1).used, false);
  assert.equal(await saved.textContent(), originalPath);
  assert.equal(await referenceExists.textContent(), "yes");
  console.log("PASS: unused Rename stays available through the production request and response handling");

  await reset();
  await selectExisting();
  await deleteAsset("catalogue-november.pdf");
  await page.getByRole("button", { name: "Options for catalogue-november.pdf", exact: true }).waitFor({ state: "detached" });
  await save.click();
  await page.getByText("The selected file no longer exists. Select or upload a replacement before saving.", { exact: true }).waitFor();
  assert.equal(await draft.textContent(), selectedPath);
  assert.equal(await saved.textContent(), originalPath);
  assert.equal(await referenceExists.textContent(), "yes");
  console.log("PASS: a missing-file Save retains the stale draft and the previous valid reference");

  await reset();
  await deleteAsset("catalogue-october.pdf");
  await expectUsedMessage();
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE, fullPage: true });
  assert.equal(apiRequests.length, 2);
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(errors, []);
  console.log("PASS: all external requests stayed inside the isolated fixture boundaries; no page errors");
  await context.close();
} finally {
  await browser.close();
}
