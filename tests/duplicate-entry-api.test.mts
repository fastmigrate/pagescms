import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

import * as duplicateEntry from "../lib/duplicate-entry.ts";

const require = createRequire(import.meta.url);

test("the file API duplicates raw saved content through the normal create path", async () => {
  const originalId = "11111111-1111-4111-8111-111111111111";
  const sourceDocument = {
    title: "Original",
    draft: false,
    id: originalId,
    future: { retained: true },
  };
  let writtenPath = "";
  let writtenDocument: Record<string, unknown> | undefined;

  const schema = {
    name: "jobs",
    type: "collection",
    path: "content/jobs",
    format: "json",
    extension: "json",
    filename: "{primary}.json",
    operations: {
      create: true,
      duplicate: { field: "title", draft: true },
    },
    view: { primary: "title" },
    fields: [
      { name: "title", type: "string", required: true },
      { name: "draft", type: "boolean" },
      { name: "id", type: "uuid" },
    ],
  };

  const pickModeledFields = (
    input: Record<string, unknown>,
    fields: Array<Record<string, any>>,
    apply: (value: unknown, field: Record<string, any>) => unknown,
  ) => Object.fromEntries(fields.map((field) => [
    field.name,
    apply(input[field.name], field),
  ]));

  const octokit = {
    rest: {
      repos: {
        async getContent({ path }: { path: string }) {
          assert.equal(path, "content/jobs/original.json");
          return {
            data: {
              type: "file",
              content: Buffer.from(JSON.stringify(sourceDocument)).toString("base64"),
            },
          };
        },
        async createOrUpdateFileContents(input: Record<string, any>) {
          writtenPath = input.path;
          writtenDocument = JSON.parse(Buffer.from(input.content, "base64").toString());
          return {
            data: {
              content: {
                type: "file",
                sha: "new-file-sha",
                name: "copy.json",
                path: input.path,
                size: input.content.length,
                download_url: "https://example.test/copy.json",
              },
              commit: {
                sha: "new-commit-sha",
                committer: { date: "2026-09-17T00:00:00Z" },
              },
            },
          };
        },
      },
    },
  };

  const createHttpError = (message: string, status: number) => Object.assign(new Error(message), { status });
  const mocks: Record<string, any> = {
    "next/server": {},
    "@/lib/upload-limits": {
      assertFileWriteOrigin: () => {},
      assertMediaContent: () => {},
      readFileRequest: (request: Request) => request.json(),
    },
    "@/lib/utils/octokit": { createOctokitInstance: () => octokit },
    "@/lib/operations": { isContentOperationAllowed: () => true },
    "@/fields/registry": { readFns: {}, writeFns: {} },
    "@/lib/config": { configVersion: "3.0", parseConfig: () => ({}), normalizeConfig: (value: unknown) => value },
    "@/lib/serialization": {
      parse: (content: string) => JSON.parse(content),
      stringify: (content: unknown) => JSON.stringify(content),
    },
    "@/lib/schema": {
      deepMap: pickModeledFields,
      generateFilename: (_pattern: string, _schema: unknown, content: Record<string, any>) => `${content.title.toLowerCase()}.json`,
      generateZodSchema: (fields: Array<Record<string, any>>) => ({
        safeParse: (content: Record<string, unknown>) => ({
          success: true,
          data: Object.fromEntries(fields.map((field) => [field.name, content[field.name]])),
        }),
      }),
      getPrimaryField: () => "title",
      getSchemaByName: () => schema,
      sanitizeObject: (value: unknown) => value,
    },
    "@/lib/config-store": {
      getConfig: async () => ({ object: { content: [schema] } }),
      updateConfig: async () => {},
    },
    "@/lib/utils/file": {
      getFileExtension: (path: string) => path.split(".").pop() ?? "",
      getFileName: (path: string) => path.split("/").pop() ?? "",
      getParentPath: (path: string) => path.split("/").slice(0, -1).join("/"),
      joinPathSegments: (parts: string[]) => parts.filter(Boolean).join("/"),
      normalizePath: (path: string) => path,
      serializedTypes: ["json"],
    },
    "@/lib/authz-shared": { assertGithubIdentity: () => {} },
    "@/lib/token": { getToken: async () => ({ token: "test-token" }) },
    "@/lib/github-cache-file": { updateFileCache: async () => {} },
    "@/lib/api-error": {
      createHttpError,
      toErrorResponse: (error: any) => Response.json(
        { status: "error", message: error.message },
        { status: error.status ?? 500 },
      ),
    },
    "lodash.mergewith": require("lodash.mergewith"),
    "@/lib/commit-message": {
      buildCommitTokens: () => ({}),
      resolveCommitIdentity: () => "app",
      resolveCommitMessage: () => "Create copy",
    },
    "@/lib/session-server": {
      requireApiUserSession: async () => ({ user: { id: "user", name: "Editor" } }),
    },
    "@/lib/duplicate-entry": duplicateEntry,
  };

  const source = readFileSync(
    new URL("../app/api/[owner]/[repo]/[branch]/files/[path]/route.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const route = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(
    (id: string) => mocks[id] ?? {},
    route,
    route.exports,
  );

  const request = new Request("https://cms.test/api/o/r/main/files/content%2Fjobs%2Foriginal.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "content",
      name: "jobs",
      duplicate: { value: "Copy" },
      onConflict: "error",
    }),
  });
  const response = await route.exports.POST(request, {
    params: Promise.resolve({
      owner: "o",
      repo: "r",
      branch: "main",
      path: "content/jobs/original.json",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(writtenPath, "content/jobs/copy.json");
  assert.equal(writtenDocument?.title, "Copy");
  assert.equal(writtenDocument?.draft, true);
  assert.deepEqual(writtenDocument?.future, { retained: true });
  assert.notEqual(writtenDocument?.id, originalId);
});
