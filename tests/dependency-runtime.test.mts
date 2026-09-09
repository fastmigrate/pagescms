import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("patched Tiptap does not inherit DOM attributes from a __proto__ key", () => {
  const { mergeAttributes } = require("@tiptap/core");
  const attributes = mergeAttributes({ class: "existing" }, JSON.parse('{"__proto__":{"onload":"unexpected"},"title":"Artwork"}'));
  assert.equal(attributes.onload, undefined);
  assert.equal(attributes.title, "Artwork");
  assert.equal(attributes.class, "existing");
});

test("patched Sharp can encode and decode AVIF artwork thumbnails", async () => {
  const sharp = require("sharp");
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#446688" } }).avif().toBuffer();
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 3);
  assert.equal((await sharp(bytes).raw().toBuffer()).length, 4 * 3 * 3);
});

test("patched Nodemailer composes email using an in-memory transport without delivery", async () => {
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await transport.sendMail({ from: "cms@example.invalid", to: "editor@example.invalid", subject: "CMS invitation fixture", text: "Local composition smoke only." });
  assert.deepEqual(result.envelope.to, ["editor@example.invalid"]);
  assert.match(result.message.toString(), /Subject: CMS invitation fixture/);
  assert.match(result.message.toString(), /Local composition smoke only\./);
  transport.close();
});
