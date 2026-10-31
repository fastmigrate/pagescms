#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.FIXTURE_URL || "http://127.0.0.1:4598/dev/fixtures/image-ai-status";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).origin !== new URL(baseUrl).origin || request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 90_000 });
  const field = page.getByRole("region", { name: "Image field", exact: true });
  await field.getByRole("button", { name: "Remove image", exact: true }).waitFor();
  if (process.env.BEFORE_IMAGE) await page.screenshot({ path: process.env.BEFORE_IMAGE });
  assert.equal(await field.getByRole("combobox", { name: "AI-Kennzeichnung", exact: true }).count(), 0, "existing images must not show the next-upload classification selector");
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  console.log("PASS: the existing generated image displays its stored classification without an upload selector");
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE });
  const scenario = page.getByLabel("Scenario", { exact: true });
  const saved = () => page.getByLabel("Saved image reference", { exact: true }).textContent();
  const uploads = async () => JSON.parse(await page.getByLabel("Uploaded files", { exact: true }).textContent());
  await field.getByRole("button", { name: "Save recipe", exact: true }).click();
  assert.equal(await saved(), '"media/generated.jpg"');
  assert.deepEqual(await uploads(), []);
  await scenario.selectOption("root");
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  assert.equal(await saved(), '"generated.jpg"');
  console.log("PASS: repository-root images use the existing encoded-slash directory read");
  for (const [value, label] of [["modified", "AI MODIFIED"], ["unmarked", "Keine Kennzeichnung"], ["stale", "AI: erneut prüfen"], ["error", "AI-Status nicht verfügbar"], ["missing", "AI-Status nicht verfügbar"]]) {
    await scenario.selectOption(value);
    await field.getByText(label, { exact: true }).waitFor();
    assert.equal(await field.getByRole("combobox", { name: "AI-Kennzeichnung", exact: true }).count(), 0);
  }
  await scenario.selectOption("slow");
  await field.getByText("AI-Status wird geladen …", { exact: true }).waitFor();
  assert.equal(await field.getByText("Keine Kennzeichnung", { exact: true }).count(), 0);
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  console.log("PASS: modified, unmarked, stale, failed, missing, and delayed reads remain distinct");

  await scenario.selectOption("generated");
  await page.getByLabel("Multiple images", { exact: true }).check();
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  await field.getByText("AI MODIFIED", { exact: true }).waitFor();
  await page.getByLabel("Readonly", { exact: true }).check();
  await field.getByText("AI MODIFIED", { exact: true }).waitFor();
  assert.equal(await field.getByRole("button", { name: "Remove image", exact: true }).count(), 0);
  assert.equal(await field.getByRole("button", { name: "Upload", exact: true }).count(), 0);
  await page.getByLabel("Multiple images", { exact: true }).uncheck();
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  console.log("PASS: each gallery image and readonly image displays its own stored status");

  await page.getByLabel("Readonly", { exact: true }).uncheck();
  await field.getByRole("button", { name: "Remove image", exact: true }).click();
  await field.getByRole("button", { name: "Select", exact: true }).click();
  const library = page.getByRole("dialog");
  await library.getByText("modified.jpg", { exact: true }).waitFor();
  assert.equal(await library.getByRole("combobox", { name: "AI-Kennzeichnung", exact: true }).count(), 0);
  await library.getByText("modified.jpg", { exact: true }).click();
  await library.getByRole("button", { name: "Select", exact: true }).click();
  await field.getByText("AI MODIFIED", { exact: true }).waitFor();
  assert.equal(await field.getByRole("combobox", { name: "AI-Kennzeichnung", exact: true }).count(), 0);
  assert.deepEqual(await uploads(), []);
  console.log("PASS: selecting an existing library asset reads its status without uploading or classifying it");

  await scenario.selectOption("empty");
  const file = { name: "new-generated.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fixture image") };
  const input = field.locator('input[type="file"]');
  await input.setInputFiles(file);
  const dialog = page.getByRole("dialog");
  const classification = dialog.getByRole("combobox", { name: "AI-Kennzeichnung", exact: true });
  await classification.selectOption("generated");
  assert.deepEqual(await uploads(), []);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await uploads(), []);
  assert.equal(await saved(), '""');
  await input.setInputFiles(file);
  assert.equal(await classification.inputValue(), "unmarked");
  await classification.selectOption("generated");
  if (process.env.UPLOAD_IMAGE) await page.screenshot({ path: process.env.UPLOAD_IMAGE });
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await field.getByText("AI GENERATED", { exact: true }).waitFor();
  assert.deepEqual(await uploads(), [{ path: "media/new-generated.jpg", classification: "generated" }]);
  assert.equal(await saved(), '""');
  await field.getByRole("button", { name: "Save recipe", exact: true }).click();
  assert.equal(await saved(), '"media/new-generated.jpg"');
  console.log("PASS: cancel writes nothing, retrying the same file resets classification, and upload saves the selected label before recipe save");

  await scenario.selectOption("empty");
  await page.getByLabel("Multiple images", { exact: true }).check();
  await field.getByRole("button", { name: "Remove image", exact: true }).first().waitFor();
  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["fixture"], "dropped-modified.jpg", { type: "image/jpeg" }));
    data.items.add(new File(["fixture"], "dropped.svg", { type: "image/svg+xml" }));
    return data;
  });
  await field.locator("img").first().dispatchEvent("drop", { dataTransfer: drop });
  await classification.selectOption("modified");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Uploaded files"]').textContent).length === 3);
  assert.deepEqual((await uploads()).slice(1), [
    { path: "media/dropped-modified.jpg", classification: "modified" },
    { path: "media/dropped.svg", classification: "unmarked" },
  ]);
  console.log("PASS: dropping a batch uses the chosen classification for raster images and keeps SVG unmarked");

  await page.getByLabel("Multiple images", { exact: true }).uncheck();
  await scenario.selectOption("disabled");
  assert.equal(await field.getByRole("status").count(), 0);
  await field.getByRole("button", { name: "Remove image", exact: true }).click();
  await input.setInputFiles({ ...file, name: "metadata-disabled.jpg" });
  await page.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Uploaded files"]').textContent).length === 4);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual((await uploads()).at(-1), { path: "media/metadata-disabled.jpg" });
  console.log("PASS: configurations without media metadata retain immediate uploads without AI controls");
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "the fixture must not access external services, authenticated APIs, or repository writes");
  await context.close();
} finally {
  await browser.close();
}
