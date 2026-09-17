import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDuplicateContent,
  mergeDuplicateContent,
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

test("preserves unmodeled source fields while replacing modeled values", () => {
  const merged = mergeDuplicateContent(
    {
      title: "Stored title",
      future: { retained: true, list: ["stored"] },
      items: [{ label: "Stored item", future: { retained: true } }],
    },
    {
      title: "New title",
      future: { list: ["updated"] },
      items: [{ label: "Updated item" }],
    },
  );

  assert.deepEqual(merged, {
    title: "New title",
    future: { retained: true, list: ["updated"] },
    items: [{ label: "Updated item", future: { retained: true } }],
  });
});

test("does not materialize modeled containers absent from the saved source", () => {
  const merged = mergeDuplicateContent(
    { title: "Stored title" },
    {
      title: "Stored title",
      metadata: { id: undefined, description: undefined },
    },
    true,
  );

  assert.deepEqual(merged, { title: "Stored title" });
});

test("preserves reserved-name content keys without prototype mutation", () => {
  const source = JSON.parse(`{
    "title": "Original",
    "__proto__": {"retained": true},
    "constructor": "stored constructor",
    "prototype": "stored prototype"
  }`) as Record<string, unknown>;
  const before = ({} as Record<string, unknown>).retained;

  const duplicate = buildDuplicateContent({
    source,
    field: "title",
    value: "Copy",
    draft: false,
  });

  assert.equal(duplicate.title, "Copy");
  assert.deepEqual(Object.getOwnPropertyDescriptor(duplicate, "__proto__")?.value, {
    retained: true,
  });
  assert.equal(duplicate.constructor, "stored constructor");
  assert.equal(duplicate.prototype, "stored prototype");
  assert.equal(({} as Record<string, unknown>).retained, before);
});

test("regenerates UUID identities throughout duplicated content", () => {
  const source = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Original",
    items: [{ id: "22222222-2222-4222-8222-222222222222" }],
  };
  const duplicate = buildDuplicateContent({
    source,
    field: "title",
    value: "Copy",
    draft: false,
    fields: [
      { name: "id", type: "uuid" },
      { name: "title", type: "string" },
      {
        name: "items",
        type: "object",
        list: true,
        fields: [{ name: "id", type: "uuid" }],
      },
    ],
  });

  assert.match(String(duplicate.id), /^[0-9a-f-]{36}$/u);
  assert.notEqual(duplicate.id, source.id);
  const items = duplicate.items as Array<Record<string, unknown>>;
  assert.match(String(items[0].id), /^[0-9a-f-]{36}$/u);
  assert.notEqual(items[0].id, source.items[0].id);
});

test("rejects prototype-related keys without modifying global objects", () => {
  const before = ({} as Record<string, unknown>).polluted;
  assert.throws(
    () => buildDuplicateContent({
      source: { title: "Original" },
      field: "__proto__.polluted",
      value: "yes",
      draft: false,
    }),
    /Unsafe content key/u,
  );
  assert.equal(({} as Record<string, unknown>).polluted, before);
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
