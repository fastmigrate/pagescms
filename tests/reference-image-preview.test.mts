import assert from "node:assert/strict";
import test from "node:test";
import { referenceImage } from "../fields/core/reference/image-preview.ts";

test("reference previews preserve the transformed repository path and media source", () => {
  assert.deepEqual(referenceImage("website/public/images/works/01 painting.jpg", "works_images"), {
    path: "website/public/images/works/01 painting.jpg", media: "works_images",
  });
});

test("multiple images use the first image without changing reference values", () => {
  assert.deepEqual(referenceImage(["media/one.jpg", "media/two.jpg"], "images"), {
    path: "media/one.jpg", media: "images",
  });
});

test("missing images and invalid values fall back without breaking selection", () => {
  for (const value of [null, undefined, "", "  ", [], {}, 42, [null]]) {
    assert.equal(referenceImage(value, "images"), null);
  }
  for (const media of [false, undefined, "", {}]) {
    assert.equal(referenceImage("media/art.jpg", media), null);
  }
});

test("external and non-repository image sources do not enter the media resolver", () => {
  for (const path of ["https://example.com/a.jpg", "//example.com/a.jpg", "data:image/png;base64,abc", "javascript:alert(1)"]) {
    assert.equal(referenceImage(path, "images"), null);
  }
});
