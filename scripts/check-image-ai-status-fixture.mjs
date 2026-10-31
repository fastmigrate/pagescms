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
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "the fixture must not access external services, authenticated APIs, or repository writes");
  if (process.env.AFTER_IMAGE) await page.screenshot({ path: process.env.AFTER_IMAGE });
  await context.close();
} finally {
  await browser.close();
}
