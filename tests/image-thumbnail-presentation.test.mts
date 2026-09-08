import assert from "node:assert/strict";
import test from "node:test";
import { thumbnailPresentation } from "../fields/core/image/thumbnail-presentation.ts";

test("collection thumbnails preserve the existing default", () => {
  assert.deepEqual(thumbnailPresentation(), { className: "w-8", fit: "cover" });
});
test("large and medium image fields opt into full-frame thumbnails", () => {
  assert.deepEqual(thumbnailPresentation({ thumbnailSize: "large", thumbnailFit: "contain" }), { className: "w-24", fit: "contain" });
  assert.equal(thumbnailPresentation({ thumbnailSize: "medium" }).className, "w-16");
});
test("unrecognized or inherited sizing values cannot inject classes", () => {
  for (const thumbnailSize of ["constructor", "__proto__", "w-screen", 1000, null]) {
    assert.deepEqual(thumbnailPresentation({ thumbnailSize, thumbnailFit: "invalid" }), { className: "w-8", fit: "cover" });
  }
});
