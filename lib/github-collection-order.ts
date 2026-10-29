import { z } from "zod";
import { applyEdits, modify } from "jsonc-parser";
import { readFns } from "@/fields/registry";
import { createHttpError } from "@/lib/api-error";
import { buildCommitTokens, resolveCommitIdentity, resolveCommitMessage } from "@/lib/commit-message";
import { normalizeConfig, parseAndValidateConfig } from "@/lib/config";
import { comparePresetEntries, type SortPreset } from "@/lib/collection-sort";
import { orderValues, reorderDefinition, type OrderSnapshot, type ReorderDefinition } from "@/lib/collection-order";
import { clearFileCache, setBranchHeadSha, updateFileCache } from "@/lib/github-cache-file";
import { getFieldByPath, getPrimaryField, getSchemaByName } from "@/lib/schema";
import { parse } from "@/lib/serialization";
import { MAX_FILE_REQUEST_BYTES } from "@/lib/upload-limits";
import { getFileName, getParentPath, normalizePath } from "@/lib/utils/file";
import { createOctokitInstance } from "@/lib/utils/octokit";

type OrderContext = {
  owner: string;
  repo: string;
  branch: string;
  name: string;
  token: string;
  user?: { id: string; name?: string | null; email?: string | null };
};
type OrderDocument = {
  path: string;
  sha: string;
  mode: "100644" | "100755";
  content: Record<string, unknown>;
  source: string;
};
type LoadedOrder = {
  head: string;
  treeSha: string;
  configSha: string;
  configObject: Record<string, any>;
  schema: Record<string, any>;
  definition: ReorderDefinition;
  documents: OrderDocument[];
  snapshot: OrderSnapshot;
};
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const OrderSaveSchema = z.object({
  expectedHead: sha,
  configSha: sha,
  groupId: z.string().min(1),
  baseline: z.array(z.object({ path: z.string().min(1), sha }).strict()),
  paths: z.array(z.string().min(1)),
}).strict();

function assertPath(path: string, allowRoot = false) {
  if ((!path && !allowRoot) || path.startsWith("/") || path.includes("\\") || /[\0\r\n]/.test(path)
    || normalizePath(path) !== path || path.split("/").some(part => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw createHttpError("Invalid collection repository path.", 400);
  }
}

function valueAt(content: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) =>
    value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part] : undefined, content);
}

function orderParent(content: Record<string, unknown>, field: string, path: string) {
  const parts = field.split(".");
  let parent = content;
  for (const part of parts.slice(0, -1)) {
    const value = Object.hasOwn(parent, part) ? parent[part] : undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw createHttpError(`Manual order requires an existing object at "${part}" in "${path}".`, 400);
    }
    parent = value as Record<string, unknown>;
  }
  return { parent, key: parts[parts.length - 1] };
}

function snapshotFor(loaded: Omit<LoadedOrder, "snapshot" | "treeSha">): OrderSnapshot {
  const { schema, definition, configObject } = loaded;
  const config = { object: configObject };
  const readValue = (value: unknown, path: string) => {
    const field = getFieldByPath(schema.fields, path);
    const transformed = field && typeof field.type === "string" && readFns[field.type]
      ? readFns[field.type](value, field, config) : undefined;
    return transformed === undefined ? value : transformed;
  };
  const preset: SortPreset = {
    ...definition.preset,
    fields: definition.preset.fields.map(rule => ({
      ...rule,
      values: rule.values?.map(value => readValue(value, rule.field)) as typeof rule.values,
    })),
  };
  const primary = getPrimaryField(schema);
  const paths = new Set([...preset.fields.map(rule => rule.field), ...(primary ? [primary] : [])]);
  const entries = loaded.documents.map(document => {
    const fields: Record<string, any> = Object.create(null);
    for (const path of paths) {
      const parts = path.split(".");
      let target = fields;
      for (const part of parts.slice(0, -1)) target = target[part] ??= Object.create(null);
      target[parts[parts.length - 1]] = readValue(valueAt(document.content, path), path);
    }
    return { document, fields, path: document.path };
  }).sort((a, b) => comparePresetEntries(a, b, preset));
  const groups = new Map<string, { id: string; label: string; entries: OrderSnapshot["groups"][number]["entries"][number][] }>();
  for (const { document, fields } of entries) {
    const values = definition.groupFields.map(path => {
      const value = valueAt(fields, path);
      if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) return null;
      if (!["string", "number", "boolean"].includes(typeof value)) throw createHttpError(`Invalid group value in "${document.path}".`, 400);
      return value;
    });
    const id = JSON.stringify(values);
    let group = groups.get(id);
    if (!group) {
      const label = values.length
        ? values.map((value, index) => `${getFieldByPath(schema.fields, definition.groupFields[index])?.label || definition.groupFields[index]}: ${value ?? "(empty)"}`).join(" / ")
        : "All entries";
      group = { id, label, entries: [] };
      groups.set(id, group);
    }
    const value = valueAt(document.content, definition.field);
    const label = primary ? valueAt(fields, primary) : undefined;
    group.entries.push({
      path: document.path,
      sha: document.sha,
      label: label != null && label !== "" && ["string", "number", "boolean"].includes(typeof label) ? String(label) : getFileName(document.path),
      value: typeof value === "number" && Number.isFinite(value) ? value : null,
    });
  }
  for (const group of groups.values()) {
    try { orderValues(definition, group.entries.length); }
    catch (error) { throw createHttpError(error instanceof Error ? error.message : "Invalid manual order values.", 400); }
  }
  return { head: loaded.head, configSha: loaded.configSha, field: definition.field, groups: [...groups.values()] };
}

async function loadOrder(options: OrderContext, octokit: ReturnType<typeof createOctokitInstance>, expectedHead?: string): Promise<LoadedOrder> {
  const { owner, repo, branch, name } = options;
  const ref = { owner, repo };
  const { data: head } = await octokit.rest.git.getRef({ ...ref, ref: `heads/${branch}` });
  if (expectedHead && expectedHead !== head.object.sha) throw createHttpError("Repository changed. Reload the order before saving.", 409);
  const { data: commit } = await octokit.rest.git.getCommit({ ...ref, commit_sha: head.object.sha });
  const { data: tree } = await octokit.rest.git.getTree({ ...ref, tree_sha: commit.tree.sha, recursive: "true" });
  if (tree.truncated) throw createHttpError("Repository tree is too large to load the complete collection order.", 413);
  const configEntry = tree.tree.find(entry => entry.path === ".pages.yml");
  if (!configEntry) throw createHttpError("Configuration not found.", 404);
  const readBlob = async (entry: typeof configEntry) => {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode ?? "") || !entry.sha) throw createHttpError(`Expected a regular file at "${entry.path}".`, 400);
    if ((entry.size ?? 0) > MAX_FILE_REQUEST_BYTES) throw createHttpError(`File "${entry.path}" exceeds the supported size.`, 413);
    const { data } = await octokit.rest.git.getBlob({ ...ref, file_sha: entry.sha });
    const bytes = Buffer.from(data.content, "base64");
    if ((data.size ?? bytes.length) > MAX_FILE_REQUEST_BYTES || bytes.length > MAX_FILE_REQUEST_BYTES) throw createHttpError(`File "${entry.path}" exceeds the supported size.`, 413);
    return bytes.toString("utf8");
  };
  const { document, parseErrors, validationErrors } = parseAndValidateConfig(await readBlob(configEntry));
  const errors = [...parseErrors, ...validationErrors];
  if (errors.length) throw createHttpError(`Configuration validation failed: ${errors.map(error => error.message).join("; ")}`, 400);
  const configObject = normalizeConfig(document.toJSON());
  const schema = getSchemaByName(configObject, name);
  if (!schema) throw createHttpError(`Collection not found for "${name}".`, 404);
  let definition: ReorderDefinition;
  try { definition = reorderDefinition(schema); }
  catch (error) { throw createHttpError(error instanceof Error ? error.message : "Invalid manual ordering configuration.", 400); }
  assertPath(schema.path, true);
  const metadataPath = configObject.mediaMetadata ? normalizePath(configObject.mediaMetadata) : undefined;
  if (metadataPath && getParentPath(metadataPath) === schema.path
    && (!schema.extension || metadataPath.endsWith(`.${schema.extension}`))
    && !(schema.exclude ?? []).includes(getFileName(metadataPath))) {
    throw createHttpError(`The media metadata document is reserved for AI media operations. Exclude "${getFileName(metadataPath)}" from this collection before ordering.`, 400);
  }
  const members = tree.tree.filter(entry =>
    entry.path && getParentPath(entry.path) === schema.path && entry.type !== "tree"
    && (!schema.extension || entry.path.endsWith(`.${schema.extension}`))
    && !(schema.exclude ?? []).includes(getFileName(entry.path)),
  );
  const documents: OrderDocument[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < members.length; index += 10) {
    const batch = await Promise.all(members.slice(index, index + 10).map(async entry => {
      assertPath(entry.path!);
      if (seen.has(entry.path!)) throw createHttpError("Duplicate collection path in repository tree.", 400);
      seen.add(entry.path!);
      const source = await readBlob(entry);
      let content: unknown;
      try { content = parse(source, { format: "json" }); }
      catch (error: any) {
        if (error.status) throw error;
        throw createHttpError(`Invalid JSON in "${entry.path}".`, 400);
      }
      if (!content || typeof content !== "object" || Array.isArray(content)) throw createHttpError(`Collection entry "${entry.path}" must contain a JSON object.`, 400);
      orderParent(content as Record<string, unknown>, definition.field, entry.path!);
      return { path: entry.path!, sha: entry.sha!, mode: entry.mode as OrderDocument["mode"], content: content as Record<string, unknown>, source };
    }));
    documents.push(...batch);
  }
  const loaded = { head: head.object.sha, treeSha: commit.tree.sha, configSha: configEntry.sha!, configObject, schema, definition, documents };
  return { ...loaded, snapshot: snapshotFor(loaded) };
}

export async function readCollectionOrder(options: OrderContext): Promise<OrderSnapshot> {
  const octokit = createOctokitInstance(options.token);
  return (await loadOrder(options, octokit)).snapshot;
}

export async function saveCollectionOrder(options: OrderContext, input: unknown): Promise<OrderSnapshot> {
  const parsed = OrderSaveSchema.safeParse(input);
  if (!parsed.success) throw createHttpError("Invalid collection order request.", 400);
  const data = parsed.data;
  for (const path of [...data.paths, ...data.baseline.map(entry => entry.path)]) assertPath(path);
  if (new Set(data.paths).size !== data.paths.length || new Set(data.baseline.map(entry => entry.path)).size !== data.baseline.length) throw createHttpError("Collection order paths must be unique.", 400);
  const octokit = createOctokitInstance(options.token, { retry: { doNotRetry: [409, 422] } });
  const loaded = await loadOrder(options, octokit, data.expectedHead);
  if (data.configSha !== loaded.configSha) throw createHttpError("Configuration changed. Reload the order before saving.", 409);
  const group = loaded.snapshot.groups.find(group => group.id === data.groupId);
  if (!group) throw createHttpError("The complete order group is no longer available. Reload the order before saving.", 409);
  const baseline = new Map(data.baseline.map(entry => [entry.path, entry.sha]));
  const paths = new Set(data.paths);
  if (group.entries.length !== baseline.size || group.entries.length !== paths.size
    || group.entries.some(entry => baseline.get(entry.path) !== entry.sha || !paths.has(entry.path))) {
    throw createHttpError("The complete order group or its files have changed. Reload the order before saving.", 409);
  }
  if (group.entries.every((entry, index) => entry.path === data.paths[index])) return loaded.snapshot;
  const values = orderValues(loaded.definition, data.paths.length);
  const documents = new Map(loaded.documents.map(document => [document.path, document]));
  const changes = data.paths.flatMap((path, index) => {
    const document = documents.get(path)!;
    if (valueAt(document.content, loaded.definition.field) === values[index]) return [];
    const text = applyEdits(document.source, modify(document.source, loaded.definition.field.split("."), values[index], {}));
    const content = parse(text, { format: "json" });
    if (valueAt(content, loaded.definition.field) !== values[index]) throw createHttpError(`Ambiguous order field in "${path}". Remove duplicate JSON keys before ordering.`, 400);
    if (Buffer.byteLength(text) > MAX_FILE_REQUEST_BYTES) throw createHttpError(`File "${path}" exceeds the supported size.`, 413);
    return [{ ...document, content, source: text, text }];
  });
  if (!changes.length) return loaded.snapshot;
  const { owner, repo, branch, user } = options;
  const ref = { owner, repo };
  const identity = resolveCommitIdentity({ configObject: loaded.configObject, identityOverride: loaded.schema.commit?.identity });
  const committer = identity === "user" && user?.email ? { name: user.name?.trim() || user.email, email: user.email } : undefined;
  const message = resolveCommitMessage({
    configObject: loaded.configObject,
    templatesOverride: loaded.schema.commit?.templates,
    action: "update",
    tokens: buildCommitTokens({ action: "update", ...ref, branch, path: loaded.schema.path, contentName: options.name, user: user?.email || user?.name || user?.id, userName: committer?.name, userEmail: committer?.email }),
  });
  const nextDocuments = new Map(loaded.documents.map(document => [document.path, document]));
  const tree = [];
  for (const change of changes) {
    const { data: blob } = await octokit.rest.git.createBlob({ ...ref, content: change.text, encoding: "utf-8" });
    nextDocuments.set(change.path, { ...change, sha: blob.sha });
    tree.push({ path: change.path, mode: change.mode, type: "blob" as const, sha: blob.sha });
  }
  const nextSnapshot = snapshotFor({ ...loaded, documents: [...nextDocuments.values()] });
  const { data: nextTree } = await octokit.rest.git.createTree({ ...ref, base_tree: loaded.treeSha, tree });
  const { data: nextCommit } = await octokit.rest.git.createCommit({ ...ref, tree: nextTree.sha, parents: [loaded.head], message, committer });
  try {
    await octokit.rest.git.updateRef({ ...ref, ref: `heads/${branch}`, sha: nextCommit.sha, force: false });
  } catch (error: any) {
    if ([409, 422].includes(error.status)) throw createHttpError("Repository changed or branch rules rejected this edit. Reload the order before saving.", 409);
    throw error;
  }
  try {
    setBranchHeadSha(owner, repo, branch, nextCommit.sha);
    for (const change of changes) {
      await updateFileCache("collection", owner, repo, branch, {
        type: "modify", path: change.path, sha: nextDocuments.get(change.path)!.sha,
        content: change.text, size: Buffer.byteLength(change.text),
        commit: { sha: nextCommit.sha, timestamp: Date.now() },
      });
    }
  } catch (error) {
    console.error("Collection order saved, but cache refresh failed.", error);
    try { await clearFileCache(owner, repo, branch); }
    catch (cacheError) { console.error("Collection order cache invalidation failed.", cacheError); }
  }
  return { ...nextSnapshot, head: nextCommit.sha };
}
