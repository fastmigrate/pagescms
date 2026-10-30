import { readFns } from "@/fields/registry";
import { createHttpError } from "@/lib/api-error";
import type { BranchTreeEntry, FileChange } from "@/lib/github-branch-mutation";
import { deepMap, getSchemaByName } from "@/lib/schema";
import { parse } from "@/lib/serialization";
import { decodePathSafely, normalizeMediaPath, normalizePath, serializedTypes } from "@/lib/utils/file";
import type { Field } from "@/types/field";

export type MediaUse = {
  assetPath: string;
  entryPath: string;
  contentName: string;
  fieldPath: string;
};

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

const context = (schema: ContentSchema, entryPath: string, fieldPath: string) => (
  `content "${schema.name}", entry "${entryPath}", field "${fieldPath}"`
);

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
      if (!isRegularBlob(entry)) throw createHttpError(`Cannot verify media references in ${context(schema, path, "$root")}. Content is not a regular Git blob.`, 400);
      if (documents.length >= limits.documents) throw createHttpError(`Cannot verify media references. The scan exceeds ${limits.documents} documents.`, 400);
      documents.push({ schema, entry });
    }
  }

  const blobs = new Map<string, Promise<Buffer>>();
  let totalBytes = 0;
  let useCount = 0;
  let removedCount = 0;
  let missingCount = 0;
  const examples: { use: MediaUse; reason: string }[] = [];
  let nextDocument = 0;
  const scanDocument = async ({ schema, entry }: typeof documents[number]) => {
    const fail = (fieldPath: string, reason: string): never => {
      throw createHttpError(`Cannot verify media references in ${context(schema, entry.path, fieldPath)}. ${reason}`, 400);
    };
    if (entry.path === configObject.mediaMetadata) fail("$root", "The reserved media metadata document cannot also be configured as typed content.");
    if (!serializedTypes.includes(schema.format)) fail("$root", `Unsupported content format "${schema.format}".`);
    if (entry.size != null && entry.size > limits.documentBytes) fail("$root", "The document exceeds the media-reference scan size limit.");
    let bytes: Buffer;
    try {
      if (entry.content) bytes = entry.content;
      else {
        if (!entry.sha) fail("$root", "The document has no immutable blob SHA.");
        if (!blobs.has(entry.sha!)) blobs.set(entry.sha!, readBlob(entry.sha!));
        bytes = await blobs.get(entry.sha!)!;
      }
    } catch (error) {
      fail("$root", `The document could not be read. ${error instanceof Error ? error.message : "Blob read failed."}`);
    }
    if (bytes!.length > limits.documentBytes) fail("$root", "The document exceeds the media-reference scan size limit.");
    totalBytes += bytes!.length;
    if (totalBytes > limits.totalBytes) fail("$root", "The media-reference scan exceeds its total size limit.");

    let parsed: any;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes!);
      parsed = parse(text, { format: schema.format, delimiters: schema.delimiters });
      if (schema.format.endsWith("-frontmatter") && isObject(parsed) && parsed.body === text) {
        const delimiter = Array.isArray(schema.delimiters) ? schema.delimiters[0] : schema.delimiters ?? (schema.format === "toml-frontmatter" ? "+++" : schema.format === "json-frontmatter" ? "{" : "---");
        const defaultJson = schema.format === "json-frontmatter" && (schema.delimiters == null || (Array.isArray(schema.delimiters) && schema.delimiters[0] === "{" && schema.delimiters[1] === "}"));
        if ((defaultJson && text.startsWith("{")) || text.startsWith(`${delimiter}\n`) || text.startsWith(`${delimiter}\r\n`)) fail("$root", "Malformed frontmatter delimiters or frontmatter data.");
      }
    } catch (error) {
      fail("$root", `The document could not be parsed. ${error instanceof Error ? error.message : "Parse failed."}`);
    }
    if (schema.list && !Array.isArray(parsed)) fail("$root", "Expected a root content list.");
    if (!schema.list && !isObject(parsed)) fail("$root", "Expected a structured content object.");
    const fields: Field[] = schema.list ? [{ name: "listWrapper", type: "object", list: true, fields: schema.fields }] : schema.fields;
    const displayPath = (path: string) => schema.list ? path.replace(/^listWrapper/u, "") || "$root" : path;

    deepMap(schema.list ? { listWrapper: parsed } : parsed, fields, (value, field, path) => {
      if (field.type !== "file" && field.type !== "image") return value;
      const fieldPath = displayPath(path);
      if (value == null || value === "") return value;
      const multiple = !!field.options?.multiple;
      if (multiple !== Array.isArray(value)) fail(fieldPath, multiple ? "Expected a list of media paths." : "Expected a media path string.");
      const values: unknown[] = multiple ? value : [value];
      values.forEach((raw, index) => {
        const indexedPath = multiple ? `${fieldPath}[${index}]` : fieldPath;
        if (typeof raw !== "string") return fail(indexedPath, "Expected a media path string.");
        if (!raw) return;
        if (++useCount > limits.uses) fail(indexedPath, "The media-reference scan exceeds its field limit.");
        let assetPath: string | undefined;
        try { assetPath = assetPathFor(raw, field, configObject); }
        catch (error) { fail(indexedPath, `${error instanceof Error ? error.message : "Unsupported media path."} Saved value "${raw.slice(0, 200)}".`); }
        if (!assetPath) return;
        const removedTarget = removed.has(assetPath);
        const missingTarget = changedPaths.has(entry.path) && (!finalEntries.has(assetPath) || !isRegularBlob(finalEntries.get(assetPath)!));
        if (!removedTarget && !missingTarget) return;
        if (removedTarget) removedCount++;
        else missingCount++;
        if (examples.length < limits.examples) examples.push({
          use: { assetPath, entryPath: entry.path, contentName: schema.name, fieldPath: indexedPath },
          reason: removedTarget ? "is removed by this change" : "does not exist in the final tree",
        });
      });
      return value;
    }, {
      onInvalidStructure: ({ field, path, reason }) => {
        if (hasMedia(field)) fail(displayPath(path), reason);
      },
    });
  };

  await Promise.all(Array.from({ length: Math.min(limits.concurrency, documents.length) }, async () => {
    while (nextDocument < documents.length) await scanDocument(documents[nextDocument++]);
  }));
  const count = removedCount + missingCount;
  if (count) {
    const details = examples.map(({ use, reason }) => `${context({ name: use.contentName } as ContentSchema, use.entryPath, use.fieldPath)} uses "${use.assetPath}", which ${reason}.`).join(" ");
    throw createHttpError(`Media reference safety refused this change. ${count} saved reference${count === 1 ? "" : "s"} affected (${removedCount} to removed files, ${missingCount} to missing files). ${details}${count > examples.length ? ` Showing ${examples.length} of ${count}.` : ""}`, 409);
  }
}
