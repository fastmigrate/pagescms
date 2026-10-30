import { prepareMediaMetadata } from "@/lib/github-media-metadata";
import { withinMedia } from "@/lib/media-metadata";
import { assertFileWriteOrigin, readFileRequest } from "@/lib/upload-limits";
import { isContentOperationAllowed } from "@/lib/operations";
import { getSchemaByName } from "@/lib/schema";
import { assertConfigRevision } from "@/lib/config-revision";
import { getFileExtension, getParentPath, normalizePath } from "@/lib/utils/file";
import { getToken } from "@/lib/token";
import { clearFileCache, updateFileCache } from "@/lib/github-cache-file";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { mutateBranch, requireSource } from "@/lib/github-branch-mutation";
import { buildCommitTokens, resolveCommitIdentity, resolveCommitMessage } from "@/lib/commit-message";
import { requireApiUserSession } from "@/lib/session-server";

/**
 * Renames a file in a GitHub repository.
 *
 * POST /api/[owner]/[repo]/[branch]/files/[path]/rename
 *
 * Requires authentication.
 */

export async function POST(
  request: Request,
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

    if (!isContentOperationAllowed("rename", { scope: "settings" }) && params.path === ".pages.yml") {
      throw createHttpError(`Renaming the settings file isn't allowed.`, 403);
    }

    const data: any = await readFileRequest(request);

    if (!data.type || !["content", "media"].includes(data.type)) throw new Error(`"type" is required and must be set to "content" or "media".`);
    if (!data.name && data.type === "content") throw new Error(`"name" is required.`);
    if (!data.newPath) throw new Error(`"newPath" is required.`);

    if (typeof data.sha !== "string" || !data.sha) throw createHttpError("Source SHA is required for rename.", 400);
    const response = await mutateBranch({ token, ...params }, async snapshot => {
      const config = { sha: snapshot.configSha, object: snapshot.configObject };
      const normalizedPath = normalizePath(params.path);
      const normalizedNewPath = normalizePath(data.newPath);
      if ([normalizedPath, normalizedNewPath].includes(config.object.mediaMetadata)) throw createHttpError("The media metadata document is reserved for AI media operations.", 400);
      if (normalizedPath === normalizedNewPath) throw new Error(`New path "${data.newPath}" is the same as the old path.`);

      let schema: Record<string, any>;
      let schemaCommitTemplates: Record<string, string> | undefined;
      let schemaCommitIdentity: "app" | "user" | undefined;

      switch (data.type) {
        case "content":
          assertConfigRevision(data.configSha, config.sha);
          if (!data.name) throw new Error(`"name" is required for content.`);

          schema = getSchemaByName(config.object, data.name);
          if (!schema) throw new Error(`Content schema not found for ${data.name}.`);
          if (!isContentOperationAllowed("rename", { schema })) {
            throw createHttpError(`Renaming entries isn't allowed for "${data.name}".`, 403);
          }
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (schema.type === "file") throw new Error(`Renaming content of type "file" isn't allowed.`);

          if (!withinMedia(normalizedPath, schema.path)) throw new Error(`Invalid path "${params.path}" for ${data.type} "${data.name}".`);
          if (!withinMedia(normalizedNewPath, schema.path)) throw new Error(`Invalid path "${data.newPath}" for ${data.type} "${data.name}".`);

          if (schema.subfolders === false && [normalizedPath, normalizedNewPath].some(path => getParentPath(path) !== schema.path)) throw createHttpError("Subfolders are not allowed for this collection.", 400);

          if (getFileExtension(normalizedPath) !== (schema.extension ?? "")) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for ${data.type} "${data.name}".`);
          if (getFileExtension(normalizedNewPath) !== (schema.extension ?? "")) throw new Error(`Invalid extension "${getFileExtension(normalizedNewPath)}" for ${data.type} "${data.name}".`);
          break;
        case "media":
          if (!data.name) throw new Error(`"name" is required for media.`);

          schema = getSchemaByName(config.object, data.name, "media");
          if (!schema) throw new Error(`Media schema not found for ${data.name}.`);
          schemaCommitTemplates = schema?.commit?.templates;
          schemaCommitIdentity = schema?.commit?.identity;

          if (!withinMedia(normalizedPath, schema.input)) throw new Error(`Invalid path "${params.path}" for media.`);
          if (!withinMedia(normalizedNewPath, schema.input)) throw new Error(`Invalid path "${data.newPath}" for media.`);

          if (
            schema.extensions?.length > 0 &&
            !schema.extensions.includes(getFileExtension(normalizedPath))
          ) throw new Error(`Invalid extension "${getFileExtension(normalizedPath)}" for media.`);
          if (
            schema.extensions?.length > 0 &&
            !schema.extensions.includes(getFileExtension(normalizedNewPath))
          ) throw new Error(`Invalid extension "${getFileExtension(normalizedNewPath)}" for media.`);
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

      const source = requireSource(snapshot, normalizedPath, data.sha);
      if (snapshot.entries.has(normalizedNewPath)) throw createHttpError("Destination already exists.", 409);
      const prepared = config.object.mediaMetadata && config.object.media?.some((media: any) => withinMedia(normalizedPath, media.input) || withinMedia(normalizedNewPath, media.input))
        ? await prepareMediaMetadata(snapshot, { action: "rename", path: normalizedPath, newPath: normalizedNewPath, sha: data.sha }) : undefined;
      const action = "rename";
      const message = resolveCommitMessage({ configObject: config.object, templatesOverride: schemaCommitTemplates, action, tokens: buildCommitTokens({ action, ...params, path: normalizedNewPath, oldPath: normalizedPath, newPath: normalizedNewPath, contentName: data.name, user: user.email || user.name || String(user.id || ""), userName: committer?.name, userEmail: committer?.email }) });
      return { changes: prepared?.changes ?? [{ action: "remove" as const, path: normalizedPath }, { action: "copy" as const, path: normalizedNewPath, sha: source.sha!, mode: source.mode as "100644" | "100755" }], result: { path: normalizedPath, newPath: normalizedNewPath }, message, committer };
    });
    try {
      await updateFileCache(data.type === "content" ? "collection" : "media", params.owner, params.repo, params.branch, {
        type: "rename", path: response.path, newPath: response.newPath, commit: { sha: response.commitSha, timestamp: Date.now() },
      });
    } catch (error) {
      console.error("File renamed, but cache refresh failed.", error);
      try { await clearFileCache(params.owner, params.repo, params.branch); }
      catch (cacheError) { console.error("File cache invalidation failed.", cacheError); }
    }
    return Response.json({ status: "success", message: `File "${response.path}" moved to "${response.newPath}".`, data: { path: response.path, newPath: response.newPath } });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}
