import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { getConfig } from "@/lib/config-store";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { assertFileWriteOrigin, readFileRequest } from "@/lib/upload-limits";
import { assertRepositoryPath, withinMedia } from "@/lib/media-metadata";
import { mutateMediaMetadata } from "@/lib/github-media-metadata";
import { resolveCommitIdentity } from "@/lib/commit-message";

export async function POST(request: Request, context: { params: Promise<{ owner: string; repo: string; branch: string; name: string; path: string }> }) {
  try {
    assertFileWriteOrigin(request);
    const params = await context.params;
    const session = await requireApiUserSession();
    if ("response" in session) return session.response;
    const { token } = await getToken(session.user, params.owner, params.repo, true);
    if (!token) throw createHttpError("Token not found.", 401);
    const config = await getConfig(params.owner, params.repo, params.branch, { getToken: async () => token });
    if (!config?.object.mediaMetadata) throw createHttpError("AI labeling is not configured.", 400);
    assertRepositoryPath(params.path);
    const media = config.object.media?.find((item: any) => item.name === params.name);
    if (!media || !withinMedia(params.path, media.input)) throw createHttpError("Invalid media path.", 400);
    const data = await readFileRequest(request);
    if (typeof data.sha !== "string" || typeof data.revision !== "string") throw createHttpError("Source SHA and metadata revision are required.", 400);
    if (!["generated", "modified", "unmarked"].includes(data.classification) || Object.hasOwn(data, "derivedFrom")) throw createHttpError("An explicit AI classification is required; manual variants are not supported.", 400);
    const identity = resolveCommitIdentity({ configObject: config.object, identityOverride: media.commit?.identity });
    const committer = identity === "user" && session.user.email ? { name: session.user.name?.trim() || session.user.email, email: session.user.email } : undefined;
    const result = await mutateMediaMetadata({ token, ...params, configObject: config.object, committer, contentName: media.name, user: session.user.email || session.user.name || String(session.user.id || ""), templatesOverride: media.commit?.templates }, { action: "classify", path: params.path, sha: data.sha, revision: data.revision, classification: data.classification });
    return Response.json({ status: "success", data: result.ai });
  } catch (error) { return toErrorResponse(error); }
}
