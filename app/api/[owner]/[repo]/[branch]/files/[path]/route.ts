import { prepareMediaMetadata } from "@/lib/github-media-metadata";
import { withinMedia } from "@/lib/media-metadata";
import { assertFileWriteOrigin, assertMediaContent, readFileRequest } from "@/lib/upload-limits";
import { type NextRequest } from "next/server";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { isContentOperationAllowed } from "@/lib/operations";
import { readFns, writeFns } from "@/fields/registry";
import { configVersion, parseConfig, normalizeConfig } from "@/lib/config";
import { stringify, parse } from "@/lib/serialization";
import { deepMap, generateFilename, generateZodSchema, getPrimaryField, getSchemaByName, sanitizeObject } from "@/lib/schema";
import { assertConfigRevision } from "@/lib/config-revision";
import { getConfig, updateConfig } from "@/lib/config-store";
import { getFileExtension, getFileName, normalizePath, serializedTypes, getParentPath, joinPathSegments } from "@/lib/utils/file";
import { assertGithubIdentity } from "@/lib/authz-shared";
import { getToken } from "@/lib/token";
import { clearFileCache, updateFileCache } from "@/lib/github-cache-file";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import mergeWith from "lodash.mergewith";
import { buildCommitTokens, resolveCommitIdentity, resolveCommitMessage } from "@/lib/commit-message";
import { requireApiUserSession } from "@/lib/session-server";
import { buildDuplicateContent, mergeDuplicateContent, mergeSanitizedDuplicateContent, resolveDuplicateOperation } from "@/lib/duplicate-entry";

import { allocateFilePath, gitBlobSha, mutateBranch, requireSource, type FileChange } from "@/lib/github-branch-mutation";

export async function POST(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string; path: string }> },
) {
  try {
    assertFileWriteOrigin(request);
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;
    const user = sessionResult.user;
    const { token } = await getToken(user, params.owner, params.repo, true);
    if (!token) throw new Error("Token not found");
    const data: any = await readFileRequest(request);
    if (data.type === "settings") return await saveSettings(token, params, user, data);
    const onConflict = data.duplicate != null || data.onConflict === "error" ? "error" : "rename";
    const result = await mutateBranch({ token, ...params }, async snapshot => {
      const config = { sha: snapshot.configSha, object: snapshot.configObject };
      let normalizedPath = normalizePath(params.path);
      if (config.object.mediaMetadata === normalizedPath) throw createHttpError("The media metadata document is reserved for AI media operations.", 400);
      if (config.object.mediaMetadata && Object.hasOwn(data, "derivedFrom")) throw createHttpError("Manual media variants are not supported.", 400);
      let contentBase64;
      let schema;
      let duplicateSourceContentObject: Record<string, unknown> | undefined;
      let schemaCommitTemplates: Record<string, string> | undefined;
      let schemaCommitIdentity: "app" | "user" | undefined;

      switch (data.type) {
        case "content":
          assertConfigRevision(data.configSha, config?.sha);
          if (!data.name) throw new Error(`"name" is required for content.`);

          schema = getSchemaByName(config?.object, data.name);
          if (!schema) throw new Error(`Content schema not found for ${data.name}.`);
          if (!data.sha && !isContentOperationAllowed("create", { schema })) {
            throw createHttpError(`Creating entries isn't allowed for "${data.name}".`, 403);
          }
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (data.duplicate != null) {
            if (data.sha) throw new Error("A duplicate cannot update an existing file.");
            if (!isContentOperationAllowed("duplicate", { schema })) {
              throw createHttpError(`Duplicating entries isn't allowed for "${data.name}".`, 403);
            }
            if (schema.list || !serializedTypes.includes(schema.format) || !schema.fields) {
              throw createHttpError("Only structured non-list collections can be duplicated.", 400);
            }

            const operation = resolveDuplicateOperation(schema, getPrimaryField(schema));
            const duplicateValue = typeof data.duplicate?.value === "string"
              ? data.duplicate.value.trim()
              : "";
            if (!operation || !duplicateValue) {
              throw createHttpError("A valid duplicate value is required.", 400);
            }

            const sourcePath = normalizedPath;
            if (
              (schema.path && !sourcePath.startsWith(`${schema.path}/`))
              || getFileExtension(sourcePath) !== (schema.extension ?? "")
            ) {
              throw createHttpError(`Invalid duplicate source path "${params.path}".`, 400);
            }

            const sourceText = (await snapshot.readFile(sourcePath)).toString("utf8");
            const sourceContent = parse(sourceText, {
              format: schema.format,
              delimiters: schema.delimiters,
            });
            if (!sourceContent || typeof sourceContent !== "object" || Array.isArray(sourceContent)) {
              throw createHttpError("Duplicate source must contain a structured object.", 400);
            }
            duplicateSourceContentObject = sourceContent;

            const modeledSource = deepMap(
              sourceContent,
              schema.fields,
              (value, field) => {
                const fieldType = field.type as string;
                return readFns[fieldType]
                  ? readFns[fieldType](value, field, config || {})
                  : value;
              },
            );
            const editorSource = sanitizeObject(
              mergeDuplicateContent(sourceContent, modeledSource, true),
            );
            data.content = buildDuplicateContent({
              source: editorSource,
              field: operation.field,
              value: duplicateValue,
              draft: operation.draft,
              fields: schema.fields,
            });

            const filename = generateFilename(schema.filename, schema, data.content);
            if (!filename) throw createHttpError("The duplicate doesn't produce a valid filename.", 400);
            const duplicateBasePath = filename.includes("/")
              ? schema.path
              : getParentPath(sourcePath);
            normalizedPath = normalizePath(joinPathSegments([duplicateBasePath, filename]));
            const collectionPath = normalizePath(schema.path);
            if (
              normalizedPath === ".."
              || normalizedPath.startsWith("../")
              || (
                collectionPath
                && normalizedPath !== collectionPath
                && !normalizedPath.startsWith(`${collectionPath}/`)
              )
            ) {
              throw createHttpError("The duplicate filename escapes the collection path.", 400);
            }
            if (normalizedPath === sourcePath) {
              throw createHttpError("The duplicate must use a different filename.", 409);
            }
          }

          if (schema.type === "file" ? normalizedPath !== schema.path : !withinMedia(normalizedPath, schema.path)) throw new Error(`Invalid path "${params.path}" for ${data.type} "${data.name}".`);

          if (schema.subfolders === false && getParentPath(normalizedPath) !== schema.path) {
            throw new Error(`Subfolders are not allowed for collection "${data.name}".`);
          }

          if (getFileName(normalizedPath) === ".gitkeep") {
            // Folder creation
            contentBase64 = "";
          } else {
            if (getFileExtension(normalizedPath) !== (schema.extension ?? "")) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for ${data.type} "${data.name}".`);

            if (serializedTypes.includes(schema.format) && schema.fields) {
              let contentFields;
              let contentObject;

              // Wrapping things in listWrapper to deal with lists at the root
              if (schema.list) {
                contentObject = { listWrapper: data.content };
                contentFields = [{
                  name: "listWrapper",
                  type: "object",
                  list: true,
                  fields: schema.fields
                }]
              } else {
                contentObject = data.content;
                contentFields = schema.fields;
              }

              // Use mapBlocks to convert config blocks array to a map
              const zodSchema = generateZodSchema(contentFields);
              const zodValidation = zodSchema.safeParse(contentObject);

              if (zodValidation.success === false ) {
                const errorMessages = zodValidation.error.issues.map((error: any) => {
                  let message = error.message;
                  if (error.path.length > 0) message = `${message} at ${error.path.join(".")}`;
                  return message;
                });
                throw new Error(`Content validation failed: ${errorMessages.join(", ")}`);
              }

              const validatedContentObject = deepMap(
                zodValidation.data,
                contentFields,
                (value, field) => {
                  const fieldType = field.type as string;
                  return writeFns[fieldType] ? writeFns[fieldType](value, field, config || {}) : value;
                }
              );

              const unwrappedContentObject = schema.list
                ? validatedContentObject.listWrapper
                : validatedContentObject;

              const sanitizedContentObject = sanitizeObject(unwrappedContentObject);
              let finalContentObject = duplicateSourceContentObject
                ? mergeSanitizedDuplicateContent(
                    duplicateSourceContentObject,
                    unwrappedContentObject,
                    sanitizedContentObject,
                    sanitizeObject,
                  )
                : structuredClone(unwrappedContentObject);

              if (config?.object?.settings?.content?.merge && data.sha && !schema.list) {
                const existingContent = (await snapshot.readFile(normalizedPath)).toString("utf8");
                const existingContentObject = parse(existingContent, { format: schema.format, delimiters: schema.delimiters });

                finalContentObject = mergeWith({}, existingContentObject, unwrappedContentObject, (objValue: any, srcValue: any) => {
                  if (Array.isArray(srcValue)) {
                    return srcValue;
                  }
                });
              }

              const stringifiedContentObject = stringify(
                duplicateSourceContentObject
                  ? finalContentObject
                  : sanitizeObject(finalContentObject),
                {
                  format: schema.format,
                  delimiters: schema.delimiters
                }
              );
              contentBase64 = Buffer.from(stringifiedContentObject).toString("base64");
            } else {
              contentBase64 = Buffer.from(data.content.body ?? "").toString("base64");
            }
          }
          break;
        case "media":
          if (!data.name) throw new Error(`"name" is required for media.`);

          schema = getSchemaByName(config?.object, data.name, "media");
          if (!schema) throw new Error(`Media schema not found for ${data.name}.`);
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (!withinMedia(normalizedPath, schema.input)) throw new Error(`Invalid path "${params.path}" for media "${data.name}".`);

          if (getFileName(normalizedPath) === ".gitkeep") {
            // Folder creation
            contentBase64 = "";
          } else {
            if (
              schema.extensions?.length > 0 &&
              !schema.extensions.includes(getFileExtension(normalizedPath))
            ) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for media.`);

            assertMediaContent(data.content);
            contentBase64 = data.content;
          }
          break;
        default:
          throw new Error(`Invalid type "${data.type}".`);
      }

      if (config?.object.mediaMetadata === normalizedPath) throw createHttpError("The media metadata document is reserved for AI media operations.", 400);


      const identity = resolveCommitIdentity({ configObject: config.object, identityOverride: schemaCommitIdentity });
      const committer = identity === "user" && user.email ? { name: user.name?.trim() || user.email, email: user.email } : undefined;
      if (data.sha) requireSource(snapshot, normalizedPath, data.sha);
      const bytes = Buffer.from(contentBase64, "base64");
      const managedMedia = config.object.mediaMetadata && getFileName(normalizedPath) !== ".gitkeep"
        && config.object.media?.some((media: any) => withinMedia(normalizedPath, media.input));
      const prepared = managedMedia
        ? await prepareMediaMetadata(snapshot, { action: "save", path: normalizedPath, content: contentBase64, sha: data.sha, revision: data.revision, classification: data.classification, onConflict })
        : undefined;
      let savedPath = prepared?.path ?? normalizedPath;
      if (!prepared && !data.sha && snapshot.entries.has(savedPath)) {
        if (onConflict === "error") throw createHttpError(`File "${savedPath}" already exists.`, 409);
        savedPath = allocateFilePath(savedPath, path => snapshot.entries.has(path));
      }
      if (savedPath === config.object.mediaMetadata) throw createHttpError("The media metadata document is reserved for AI media operations.", 400);
      const changes: FileChange[] = prepared?.changes ?? [{ action: "put", path: savedPath, content: bytes }];
      const action = data.sha ? "update" : "create";
      const message = resolveCommitMessage({ configObject: config.object, templatesOverride: schemaCommitTemplates, action, tokens: buildCommitTokens({ action, ...params, path: savedPath, contentName: data.name, user: user.email || user.name || String(user.id || ""), userName: committer?.name, userEmail: committer?.email }) });
      return { changes, message, committer, result: { path: savedPath, sha: prepared?.sha ?? gitBlobSha(bytes), size: bytes.length, content: bytes.toString("utf8"), ai: prepared?.ai } };
    });
    await refreshFileCache(params, data.type === "content" ? "collection" : "media", {
      type: data.sha ? "modify" : "add", path: result.path, sha: result.sha, content: result.content, size: result.size,
      commit: { sha: result.commitSha, timestamp: Date.now() },
    });
    return Response.json({ status: "success", message: `File "${result.path}" saved successfully.`, data: {
      type: "file", sha: result.sha, name: getFileName(result.path), path: result.path, extension: getFileExtension(result.path), size: result.size, ai: result.ai,
    } });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}

async function saveSettings(token: string, params: { owner: string; repo: string; branch: string; path: string }, user: any, data: any) {
  assertGithubIdentity(user, "Only GitHub users can manage settings.");
  if (normalizePath(params.path) !== ".pages.yml") throw createHttpError("Invalid settings path.", 400);
  const config = await getConfig(params.owner, params.repo, params.branch, { sync: true, ttlMs: 0, getToken: async () => token });
  const identity = resolveCommitIdentity({ configObject: config?.object });
  const committer = identity === "user" && user.email ? { name: user.name?.trim() || user.email, email: user.email } : undefined;
  const response = await githubSaveSettings(token, params.owner, params.repo, params.branch, ".pages.yml", Buffer.from(data.content.body ?? "").toString("base64"), data.sha, { configObject: config?.object, committer, user: user.email || user.name || String(user.id || "") });
  const parsed = parseConfig(data.content.body ?? "");
  const newConfig = { owner: params.owner, repo: params.repo, branch: params.branch, sha: response?.data.content?.sha as string, version: configVersion, object: normalizeConfig(parsed.document.toJSON()) };
  try { await updateConfig(newConfig); }
  catch (error) { console.error("Settings saved, but configuration cache refresh failed.", error); }
  return Response.json({ status: "success", message: "Settings saved successfully.", data: { type: "file", path: ".pages.yml", name: ".pages.yml", sha: response?.data.content?.sha, config: newConfig } });
}

async function refreshFileCache(params: { owner: string; repo: string; branch: string }, context: string, operation: Parameters<typeof updateFileCache>[4]) {
  try { await updateFileCache(context, params.owner, params.repo, params.branch, operation); }
  catch (error) {
    console.error("Files saved, but cache refresh failed.", error);
    try { await clearFileCache(params.owner, params.repo, params.branch); }
    catch (cacheError) { console.error("File cache invalidation failed.", cacheError); }
  }
}

const githubSaveSettings = async (
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  contentBase64: string,
  sha?: string,
  options?: {
    configObject?: Record<string, any>;
    templatesOverride?: Record<string, string>;
    contentName?: string;
    user?: string;
    onConflict?: "rename" | "error";
    committer?: { name: string; email: string };
  },
) => {
  // We disable retries for 409 errors as it means the file has changed (conflict on SHA)
  const octokit = createOctokitInstance(token, { retry: { doNotRetry: [409] } });

  const message = resolveCommitMessage({
    configObject: options?.configObject,
    templatesOverride: options?.templatesOverride,
    action: sha ? "update" : "create",
    tokens: buildCommitTokens({
      action: sha ? "update" : "create",
      owner,
      repo,
      branch,
      path,
      contentName: options?.contentName,
      user: options?.user,
      userName: options?.committer?.name,
      userEmail: options?.committer?.email,
    }),
  });

  try {
    // First attempt: try with original path
    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: contentBase64,
      branch,
      sha: sha || undefined,
      committer: options?.committer,
    });

    if (response.data.content && response.data.commit) {
      return response;
    }
    throw new Error("Invalid response structure");
  } catch (error: any) {
    const githubMessage = typeof error?.response?.data?.message === "string"
      ? error.response.data.message
      : undefined;

    if (error.status === 409) {
      if (githubMessage?.includes("Repository rule violations found")) {
        throw createHttpError(
          "This repository requires changes through a pull request. Save to a different branch or fork, or ask a maintainer to relax the repository rule for direct edits.",
          409,
        );
      }

      if (sha) {
        throw createHttpError(
          "File has changed since you last loaded it. Please refresh the page and try again.",
          409,
        );
      }
    }

    if (error.status === 422 && !sha) throw createHttpError("Settings already exist. Reload the settings before saving.", 409);
    throw error;
  }
};

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ owner: string, repo: string, branch: string, path: string }> }
) {
  try {
    assertFileWriteOrigin(request);
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;
    const user = sessionResult.user;

    const { token } = await getToken(user, params.owner, params.repo, true);
    if (!token) throw new Error("Token not found");

    if (!isContentOperationAllowed("delete", { scope: "settings" }) && params.path === ".pages.yml") {
      throw createHttpError(`Deleting the settings file isn't allowed.`, 403);
    }

    const searchParams = request.nextUrl.searchParams;
    const sha = searchParams.get("sha");
    const type = searchParams.get("type");
    const name = searchParams.get("name");

    if (!type || !["content", "media"].includes(type)) throw new Error(`"type" is required and must be set to "content" or "media".`);
    if (!name && type === "content") throw new Error(`"name" is required.`);
    if (!sha) throw new Error(`"sha" is required.`);

    const result = await mutateBranch({ token, ...params }, async snapshot => {
      const config = { sha: snapshot.configSha, object: snapshot.configObject };
      const normalizedPath = normalizePath(params.path);
      if (config?.object.mediaMetadata === normalizedPath) throw createHttpError("The media metadata document is reserved for AI media operations.", 400);
      let schema;
      let schemaCommitTemplates: Record<string, string> | undefined;
      let schemaCommitIdentity: "app" | "user" | undefined;

      switch (type) {
        case "content":
          if (!name) throw new Error(`"name" is required for content.`);

          schema = getSchemaByName(config.object, name);
          if (!schema) throw new Error(`Content schema not found for ${name}.`);
          if (!isContentOperationAllowed("delete", { schema })) {
            throw createHttpError(`Deleting entries isn't allowed for "${name}".`, 403);
          }
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (schema.type === "file" ? normalizedPath !== schema.path : !withinMedia(normalizedPath, schema.path)) throw new Error(`Invalid path "${params.path}" for ${type} "${name}".`);

          if (schema.subfolders === false && getParentPath(normalizedPath) !== schema.path) {
            throw new Error(`Subfolders are not allowed for collection "${name}".`);
          }

          if (getFileExtension(normalizedPath) !== (schema.extension ?? "")) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for ${type} "${name}".`);
          break;
        case "media":
          if (!name) throw new Error(`"name" is required for media.`);

          schema = getSchemaByName(config.object, name, "media");
          if (!schema) throw new Error(`Media schema not found for ${name}.`);
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (!withinMedia(normalizedPath, schema.input)) throw new Error(`Invalid path "${params.path}" for media "${name}".`);

          if (
            schema.extensions?.length > 0 &&
            !schema.extensions.includes(getFileExtension(normalizedPath))
          ) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for media.`);
          break;
      }

      const commitIdentity = resolveCommitIdentity({
        configObject: config.object,
        identityOverride: schemaCommitIdentity,
      });
      const committer = (
        commitIdentity === "user" &&
        user.email
      )
        ? {
            name: user.name?.trim() || user.email,
            email: user.email,
          }
        : undefined;

      requireSource(snapshot, normalizedPath, sha);
      const prepared = config.object.mediaMetadata && config.object.media?.some((media: any) => withinMedia(normalizedPath, media.input))
        ? await prepareMediaMetadata(snapshot, { action: "delete", path: normalizedPath, sha }) : undefined;
      const action = "delete";
      const message = resolveCommitMessage({ configObject: config.object, templatesOverride: schemaCommitTemplates, action, tokens: buildCommitTokens({ action, ...params, path: normalizedPath, contentName: name || undefined, user: user.email || user.name || String(user.id || ""), userName: committer?.name, userEmail: committer?.email }) });
      return { changes: prepared?.changes ?? [{ action: "remove" as const, path: normalizedPath }], result: { path: normalizedPath }, message, committer };
    });
    await refreshFileCache(params, type === "content" ? "collection" : "media", { type: "delete", path: result.path, commit: { sha: result.commitSha, timestamp: Date.now() } });
    return Response.json({ status: "success", message: `File "${result.path}" deleted successfully.`, data: { sha: result.commitSha } });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}
