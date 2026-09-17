import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDuplicateContent,
  resolveDuplicateOperation,
} from "../lib/duplicate-entry.ts";
import { resolveContentOperations } from "../lib/operations.ts";

test("duplicates saved content without mutating the source", () => {
  const source = {
    title: "Original",
    draft: false,
    summary: "Keep me",
    metadata: { heading: "Old heading" },
  };

  const duplicate = buildDuplicateContent({
    source,
    field: "metadata.heading",
    value: "New heading",
    draft: true,
  });

  assert.deepEqual(duplicate, {
    title: "Original",
    draft: true,
    summary: "Keep me",
    metadata: { heading: "New heading" },
  });
  assert.equal(source.draft, false);
  assert.equal(source.metadata.heading, "Old heading");
});

test("resolves localized duplicate UI options and safe defaults", () => {
  assert.deepEqual(
    resolveDuplicateOperation({ operations: { duplicate: true } }, "title"),
    {
      label: "Duplicate",
      description: "Create a new entry from the latest saved version.",
      field: "title",
      fieldLabel: undefined,
      button: "Duplicate",
      draft: false,
    },
  );

  assert.deepEqual(
    resolveDuplicateOperation({
      operations: {
        duplicate: {
          label: "Duplizieren",
          description: "Gespeicherten Stand kopieren.",
          field: "title",
          fieldLabel: "Neuer Titel",
          button: "Kopie anlegen",
          draft: true,
        },
      },
    }),
    {
      label: "Duplizieren",
      description: "Gespeicherten Stand kopieren.",
      field: "title",
      fieldLabel: "Neuer Titel",
      button: "Kopie anlegen",
      draft: true,
    },
  );

  assert.equal(resolveDuplicateOperation({ operations: {} }, "title"), null);
});

test("only enables duplication for opt-in creatable collections", () => {
  assert.equal(resolveContentOperations({ schema: { type: "collection" } }).duplicate, false);
  assert.equal(resolveContentOperations({
    schema: { type: "collection", operations: { duplicate: true } },
  }).duplicate, true);
  assert.equal(resolveContentOperations({
    schema: {
      type: "collection",
      operations: { create: false, duplicate: true },
    },
  }).duplicate, false);
  assert.equal(resolveContentOperations({
    schema: { type: "file", operations: { duplicate: true } },
  }).duplicate, false);
});
