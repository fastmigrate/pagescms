import { readFns } from "@/fields/registry";
import { createHttpError } from "@/lib/api-error";
import type { BranchTreeEntry, FileChange } from "@/lib/github-branch-mutation";
import { deepMap, getFieldByPath, getPrimaryField, getSchemaByName, safeAccess } from "@/lib/schema";
import { parse } from "@/lib/serialization";
import { decodePathSafely, normalizeMediaPath, normalizePath, serializedTypes } from "@/lib/utils/file";
import type { Field } from "@/types/field";

type EditorLocation = { contentLabel: string; entryTitle?: string; fieldLabel?: string };
type MediaReferenceIssue = { kind: "removed" | "missing"; filename: string; location: EditorLocation };
type VerificationFailure = "read" | "invalid" | "setup" | "limit";

type ProspectiveEntry = BranchTreeEntry & { content?: Buffer };
type ContentSchema = Record<string, any> & { name: string; fields: Field[]; path: string };

const limits = { documents: 2000, documentBytes: 2 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, uses: 100000, concurrency: 4, examples: 8 };
const isRegularBlob = (entry: BranchTreeEntry) => (
  (entry.type == null || entry.type === "blob")
  && (entry.mode == null || entry.mode === "100644" || entry.mode === "100755")
);
const within = (path: string, root: string) => root === "" || path === root || path.startsWith(`${root}/`);
const isExternal = (path: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(path);
const isObject = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
);

const hasMedia = (field: Field): boolean => (
  field.type === "file" || field.type === "image"
  || (field.fields?.some(hasMedia) ?? false)
  || (field.blocks?.some(hasMedia) ?? false)
);

const belongsTo = (path: string, schema: ContentSchema) => {
  if (schema.type === "file") return path === schema.path;
  if (schema.type !== "collection" || !within(path, schema.path) || path === schema.path) return false;
  const relative = schema.path ? path.slice(schema.path.length + 1) : path;
  const parts = relative.split("/");
  return (schema.subfolders !== false || parts.length === 1)
    && !parts.some((part) => schema.exclude?.includes(part))
    && (!schema.extension || path.endsWith(`.${schema.extension}`));
};

const humanize = (name: string, fallback: string) => {
  const words = name.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/[_-]+/gu, " ").trim();
  return /^[\p{L}][\p{L}\p{N} ]*$/u.test(words) && !/^[a-f\d]{16,}$/iu.test(name)
    ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
};
const labelFor = (value: { label?: string | false; name: string }, fallback: string) => (
  typeof value.label === "string" && value.label.trim() ? value.label : humanize(value.name, fallback)
);
const locationText = (location: EditorLocation) => (
  [location.contentLabel, location.entryTitle, location.fieldLabel].filter(Boolean).join(" > ")
);
const editorLocation = (schema: ContentSchema, entryPath: string, parsed?: any, field?: Field, indexedPath = ""): EditorLocation => {
  const location: EditorLocation = { contentLabel: labelFor(schema, "Content") };
  if (schema.type === "collection") {
    const rowIndex = schema.list ? /^\[(\d+)\]/u.exec(indexedPath)?.[1] : undefined;
    const record = rowIndex == null ? parsed : parsed?.[Number(rowIndex)];
    const primary = getPrimaryField(schema);
    const primaryField = primary ? getFieldByPath(schema.fields, primary) : undefined;
    const title: unknown = primary && record && primaryField && ["string", "text", "select", "number"].includes(primaryField.type)
      ? safeAccess(record, primary) : undefined;
    location.entryTitle = (typeof title === "string" && title.trim() && !/[\/\\\u0000-\u001f]/u.test(title) && !isExternal(title)) || typeof title === "number"
      ? String(title).trim() : humanize(entryPath.split("/").pop()!.replace(/\.[^.]+$/u, ""), "Untitled entry");
  }
  if (field) {
    const positions = Array.from(indexedPath.matchAll(/\[(\d+)\]/gu), (match) => `, item ${Number(match[1]) + 1}`).join("");
    location.fieldLabel = `${labelFor(field, "File field")}${positions}`;
  }
  return location;
};
const verificationMessage = (reason: VerificationFailure, location?: EditorLocation) => {
  if (reason === "limit") return "Cannot check all files for this change. Contact your site administrator before trying again.";
  const prefix = location ? `Cannot check files used in ${locationText(location)}` : "Cannot check files for this change";
  if (reason === "read") return `${prefix} because this content could not be loaded. Try again. If this continues, contact your site administrator.`;
  if (reason === "invalid") return `${prefix} because this content could not be read correctly. Contact your site administrator before trying again.`;
  return `${prefix}. Contact your site administrator before trying again.`;
};
const referenceMessage = (examples: readonly MediaReferenceIssue[], removedCount: number, missingCount: number) => {
  const displayed = examples.slice(0, 3);
  if (removedCount && missingCount) {
    const absentKind = displayed.every((issue) => issue.kind === "removed") ? "missing"
      : displayed.every((issue) => issue.kind === "missing") ? "removed" : undefined;
    const other = examples.find((issue) => issue.kind === absentKind);
    if (other) displayed[displayed.length - 1] = other;
  }
  const details = displayed.map(({ kind, filename, location }) => kind === "removed"
    ? `"${filename}" is still used in ${locationText(location)}.`
    : `"${filename}" is unavailable in ${locationText(location)}.`).join(" ");
  const prefix = missingCount ? "Cannot apply this change." : "Cannot delete or rename this file.";
  const action = removedCount
    ? "Select or upload a replacement there and save, then try again."
    : "Select or upload a replacement there and try again.";
  const remaining = removedCount + missingCount - displayed.length;
  return `${prefix} ${details} ${action}${remaining ? ` ${remaining} more use${remaining === 1 ? "" : "s"}.` : ""}`;
};

const canonicalLocalPath = (value: string) => {
  const pathname = value.split(/[?#]/u)[0];
  const decoded = decodePathSafely(pathname);
  if (/%(?:2e|2f|5c|25)/iu.test(decoded)) throw new Error("Unsupported nested path encoding.");
  if (/[\\?#\u0000-\u001f\u007f]/u.test(decoded) || isExternal(decoded)) throw new Error("Ambiguous local path characters.");
  const path = normalizePath(decoded);
  if (path === ".." || path.startsWith("../")) throw new Error("The path escapes the repository root.");
  return path;
};

const assetPathFor = (raw: string, field: Field, configObject: Record<string, any>): string | undefined => {
  if (isExternal(raw)) return undefined;

  const media = field.options?.media === false ? undefined
    : typeof field.options?.media === "string"
      ? getSchemaByName(configObject, field.options.media, "media")
      : configObject.media?.[0];
  if (typeof field.options?.media === "string" && !media) throw new Error("The selected media source does not exist.");

  const rawPath = canonicalLocalPath(raw);
  if (!media && decodePathSafely(raw.split(/[?#]/u)[0]).startsWith("/")) return undefined;
  if (!rawPath) throw new Error("A media path must identify a file.");

  if (media) {
    if (typeof media.input !== "string" || typeof media.output !== "string" || isExternal(media.output)) {
      throw new Error("The media source has no supported local input/output mapping.");
    }
    if (canonicalLocalPath(media.input) !== media.input || canonicalLocalPath(media.output) !== media.output.replace(/^\//u, "") || /[?#]/u.test(media.output)) {
      throw new Error("The media source has an ambiguous input/output mapping.");
    }
    const normalizedRaw = normalizeMediaPath(raw).split(/[?#]/u)[0];
    const normalizedOutput = media.output === "/" ? "/" : media.output.replace(/\/$/u, "");
    const fromOutput = normalizedOutput === "/" ? normalizedRaw.startsWith("/") : within(normalizedRaw, normalizedOutput);
    const fromInput = !normalizedRaw.startsWith("/") && within(normalizedRaw, media.input);
    if (fromOutput && fromInput && media.input !== normalizedOutput) {
      throw new Error("The saved path matches both input and output of its media source.");
    }
  }

  const read = readFns[field.type];
  if (!read) throw new Error(`The ${field.type} field has no registered read transform.`);
  const transformed = read(raw, field, { object: configObject });
  if (typeof transformed !== "string") throw new Error("The media read transform did not return a path.");
  const path = canonicalLocalPath(transformed);
  if (!path || (media && !within(path, media.input))) {
    throw new Error("The saved path cannot be mapped inside its media input directory.");
  }
  return path;
};

export async function assertMediaReferenceSafety({
  configObject,
  entries,
  changes,
  readBlob,
}: {
  configObject: Record<string, any>;
  entries: ReadonlyMap<string, BranchTreeEntry>;
  changes: readonly FileChange[];
  readBlob: (sha: string) => Promise<Buffer>;
}): Promise<void> {
  const finalEntries = new Map<string, ProspectiveEntry>(entries);
  const changedPaths = new Set<string>();
  for (const change of changes) {
    changedPaths.add(change.path);
    if (change.action === "remove") finalEntries.delete(change.path);
    else if (change.action === "put") finalEntries.set(change.path, { path: change.path, type: "blob", mode: "100644", content: change.content });
    else finalEntries.set(change.path, { path: change.path, type: "blob", mode: "100644", sha: change.sha });
  }
  const removed = new Set<string>();
  for (const [path, entry] of entries) {
    if (isRegularBlob(entry) && !finalEntries.has(path)) removed.add(path);
  }

  const schemas = (configObject.content ?? []).filter((schema: ContentSchema) => schema.fields?.some(hasMedia)) as ContentSchema[];
  const documents: { schema: ContentSchema; entry: ProspectiveEntry }[] = [];
  for (const schema of schemas) {
    for (const [path, entry] of finalEntries) {
      if ((schema.type === "collection" && entry.type === "tree") || (!removed.size && !changedPaths.has(path)) || !belongsTo(path, schema)) continue;
      if (!isRegularBlob(entry)) throw createHttpError(verificationMessage("read", editorLocation(schema, path)), 400);
      if (documents.length >= limits.documents) throw createHttpError(verificationMessage("limit"), 400);
      documents.push({ schema, entry });
    }
  }

  const blobs = new Map<string, Promise<Buffer>>();
  let totalBytes = 0;
  let useCount = 0;
  let removedCount = 0;
  let missingCount = 0;
  const examples: MediaReferenceIssue[] = [];
  let nextDocument = 0;
  const scanDocument = async ({ schema, entry }: typeof documents[number]) => {
    const fail = (reason: VerificationFailure): never => {
      throw createHttpError(verificationMessage(reason, editorLocation(schema, entry.path)), 400);
    };
    if (entry.path === configObject.mediaMetadata) fail("setup");
    if (!serializedTypes.includes(schema.format)) fail("setup");
    if (entry.size != null && entry.size > limits.documentBytes) fail("limit");
    let bytes: Buffer;
    try {
      if (entry.content) bytes = entry.content;
      else {
        if (!entry.sha) fail("read");
        if (!blobs.has(entry.sha!)) blobs.set(entry.sha!, readBlob(entry.sha!));
        bytes = await blobs.get(entry.sha!)!;
      }
    } catch {
      fail("read");
    }
    if (bytes!.length > limits.documentBytes) fail("limit");
    totalBytes += bytes!.length;
    if (totalBytes > limits.totalBytes) fail("limit");

    let parsed: any;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes!);
      parsed = parse(text, { format: schema.format, delimiters: schema.delimiters });
      if (schema.format.endsWith("-frontmatter") && isObject(parsed) && parsed.body === text) {
        const delimiter = Array.isArray(schema.delimiters) ? schema.delimiters[0] : schema.delimiters ?? (schema.format === "toml-frontmatter" ? "+++" : schema.format === "json-frontmatter" ? "{" : "---");
        const defaultJson = schema.format === "json-frontmatter" && (schema.delimiters == null || (Array.isArray(schema.delimiters) && schema.delimiters[0] === "{" && schema.delimiters[1] === "}"));
        if ((defaultJson && text.startsWith("{")) || text.startsWith(`${delimiter}\n`) || text.startsWith(`${delimiter}\r\n`)) fail("invalid");
      }
    } catch {
      fail("invalid");
    }
    if (schema.list && !Array.isArray(parsed)) fail("invalid");
    if (!schema.list && !isObject(parsed)) fail("invalid");
    const fields: Field[] = schema.list ? [{ name: "listWrapper", type: "object", list: true, fields: schema.fields }] : schema.fields;
    const displayPath = (path: string) => schema.list ? path.replace(/^listWrapper/u, "") || "$root" : path;

    deepMap(schema.list ? { listWrapper: parsed } : parsed, fields, (value, field, path) => {
      if (field.type !== "file" && field.type !== "image") return value;
      const fieldPath = displayPath(path);
      if (value == null || value === "") return value;
      const multiple = !!field.options?.multiple;
      if (multiple !== Array.isArray(value)) fail("invalid");
      const values: unknown[] = multiple ? value : [value];
      values.forEach((raw, index) => {
        const indexedPath = multiple ? `${fieldPath}[${index}]` : fieldPath;
        if (typeof raw !== "string") return fail("invalid");
        if (!raw) return;
        if (++useCount > limits.uses) fail("limit");
        let assetPath: string | undefined;
        try { assetPath = assetPathFor(raw, field, configObject); }
        catch { fail("setup"); }
        if (!assetPath) return;
        const removedTarget = removed.has(assetPath);
        const missingTarget = changedPaths.has(entry.path) && (!finalEntries.has(assetPath) || !isRegularBlob(finalEntries.get(assetPath)!));
        if (!removedTarget && !missingTarget) return;
        if (removedTarget) removedCount++;
        else missingCount++;
        const kind = removedTarget ? "removed" : "missing";
        if (examples.length < limits.examples || !examples.some((example) => example.kind === kind)) {
          const issue: MediaReferenceIssue = {
            kind,
            filename: assetPath.split("/").pop()!,
            location: editorLocation(schema, entry.path, parsed, field, indexedPath),
          };
          if (examples.length < limits.examples) examples.push(issue);
          else examples[examples.length - 1] = issue;
        }
      });
      return value;
    }, {
      onInvalidStructure: ({ field }) => {
        if (hasMedia(field)) fail("invalid");
      },
    });
  };

  await Promise.all(Array.from({ length: Math.min(limits.concurrency, documents.length) }, async () => {
    while (nextDocument < documents.length) await scanDocument(documents[nextDocument++]);
  }));
  const count = removedCount + missingCount;
  if (count) {
    throw createHttpError(referenceMessage(examples, removedCount, missingCount), 409);
  }
}
