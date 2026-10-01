import { createOctokitInstance } from "@/lib/utils/octokit";
import { createHttpError } from "@/lib/api-error";
import { setBranchHeadSha } from "@/lib/github-cache-file";
import { buildCommitTokens, resolveCommitMessage } from "@/lib/commit-message";
import { assertRepositoryPath, deleteRecord, effectiveClassification, fingerprint, isLabelable, parseMediaMetadata, recordRevision, renameRecords, withinMedia, type Classification, type MediaMetadata } from "@/lib/media-metadata";

type Ref = { owner: string; repo: string; branch: string };
type Options = Ref & { token: string; configObject: Record<string, any>; committer?: { name: string; email: string }; templatesOverride?: Record<string, string>; contentName?: string; user?: string };
type Operation =
  | { action: "classify"; path: string; sha: string; classification?: Classification; derivedFrom?: string; revision: string }
  | { action: "save"; path: string; sha?: string; content: string; classification?: Classification; onConflict?: "error" | "rename"; revision?: string }
  | { action: "rename"; path: string; newPath: string; sha?: string }
  | { action: "delete"; path: string; sha: string };

export async function readMediaMetadata(token: string, ref: Ref, metadataPath: string): Promise<MediaMetadata> {
  assertRepositoryPath(metadataPath);
  const octokit = createOctokitInstance(token);
  try {
    const { data } = await octokit.rest.repos.getContent({ ...ref, ref: ref.branch, path: metadataPath });
    if ((data as any).size > 2_000_000) throw createHttpError("Media metadata exceeds 2 MB.", 413);
    if (Array.isArray(data) || data.type !== "file") throw new Error("Invalid media metadata file.");
    const encoded = data.content || (await octokit.rest.git.getBlob({ owner: ref.owner, repo: ref.repo, file_sha: data.sha })).data.content;
    return parseMediaMetadata(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  } catch (error: any) {
    if (error.status === 404) return { version: 1, assets: {} };
    throw error;
  }
}

export async function mutateMediaMetadata(options: Options, operation: Operation) {
  const { owner, repo, branch, token, configObject } = options;
  const metadataPath = configObject.mediaMetadata;
  assertRepositoryPath(metadataPath);
  assertRepositoryPath(operation.path);
  if (operation.path === metadataPath) throw createHttpError("Metadata cannot be edited as a media file.", 400);
  const octokit = createOctokitInstance(token, { retry: { doNotRetry: [409, 422] } });
  const ref = { owner, repo };
  // A fresh ref and a non-forced update make the entire write a compare-and-swap.
  const { data: head } = await octokit.rest.git.getRef({ ...ref, ref: `heads/${branch}` });
  const currentSha = head.object.sha;
  const { data: commit } = await octokit.rest.git.getCommit({ ...ref, commit_sha: currentSha });
  const { data: tree } = await octokit.rest.git.getTree({ ...ref, tree_sha: commit.tree.sha, recursive: "true" });
  if (tree.truncated) throw createHttpError("Repository tree is too large for an atomic media edit.", 413);
  const entries = new Map(tree.tree.map(entry => [entry.path!, entry]));
  const source = entries.get(operation.path);
  if ((source && (source.type !== "blob" || source.mode === "120000")) || (operation.action !== "save" && !source)) throw createHttpError("Media source not found or is not a regular file.", 404);
  if (operation.action === "rename" && !operation.sha) throw createHttpError("Source SHA is required for media rename.", 400);
  if (operation.sha && operation.sha !== source?.sha) throw createHttpError("File has changed since you last loaded it. Refresh and retry.", 409);
  let doc: MediaMetadata = { version: 1, assets: {} };
  const metadataEntry = entries.get(metadataPath);
  if (metadataEntry) {
    if (metadataEntry.type !== "blob" || metadataEntry.mode === "120000") throw createHttpError("Invalid metadata file.", 400);
    const { data } = await octokit.rest.git.getBlob({ ...ref, file_sha: metadataEntry.sha! });
    if ((data.size ?? 0) > 2_000_000) throw createHttpError("Media metadata exceeds 2 MB.", 413);
    doc = parseMediaMetadata(JSON.parse(Buffer.from(data.content, "base64").toString("utf8")));
  }
  const changes: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
  let savedPath = operation.path;
  let savedSha = source?.sha;
  let size = source?.size;
  if (operation.action === "classify") {
    if (!isLabelable(savedPath)) throw createHttpError("AI labels support static JPEG, PNG, WebP and AVIF only.", 400);
    if (recordRevision(doc.assets[savedPath]) !== operation.revision) throw createHttpError("AI classification has changed. Refresh and retry.", 409);
    if (operation.classification === undefined && !operation.derivedFrom) throw createHttpError("Classification or derivative source is required.", 400);
    if (operation.derivedFrom) {
      assertRepositoryPath(operation.derivedFrom);
      if (!(configObject.media ?? []).some((media: any) => withinMedia(operation.derivedFrom!, media.input))) throw createHttpError("Derivative source is outside configured media.", 400);
      if (!Object.hasOwn(doc.assets, operation.derivedFrom)) throw createHttpError("Original image must have an AI classification first.", 400);
      if (!entries.has(operation.derivedFrom)) throw createHttpError("Derivative source not found.", 404);
    }
    let ancestor = operation.derivedFrom;
    const seen = new Set<string>();
    while (ancestor && Object.hasOwn(doc.assets, ancestor)) {
      if (seen.has(ancestor) || ancestor === savedPath) throw createHttpError("Cyclic media derivation.", 400);
      seen.add(ancestor);
      const record = doc.assets[ancestor];
      if (record.sourceGitSha && entries.get(ancestor)?.sha !== record.sourceGitSha) throw createHttpError("Derivative source changed. Review its AI classification first.", 409);
      if (!record.sourceGitSha) {
        const entry = entries.get(ancestor);
        if (!entry || entry.type !== "blob" || entry.mode === "120000") throw createHttpError("Derivative source not found.", 404);
        const { data: ancestorBlob } = await octokit.rest.git.getBlob({ ...ref, file_sha: entry.sha! });
        if (fingerprint(Buffer.from(ancestorBlob.content, "base64")) !== record.sourceSha256) throw createHttpError("Derivative source changed. Review its AI classification first.", 409);
      }
      ancestor = record.derivedFrom;
    }
    if (operation.classification !== undefined && !["generated", "modified", "unmarked"].includes(operation.classification)) throw createHttpError("Invalid AI classification.", 400);
    const { data } = await octokit.rest.git.getBlob({ ...ref, file_sha: source!.sha! });
    const previousRecord = doc.assets[savedPath];
    const currentFingerprint = fingerprint(Buffer.from(data.content, "base64"));
    if (previousRecord && previousRecord.sourceSha256 !== currentFingerprint) deleteRecord(doc, savedPath);
    doc.assets[savedPath] = { ...previousRecord, sourceSha256: currentFingerprint, sourceGitSha: source!.sha!, classification: operation.classification, derivedFrom: operation.derivedFrom || undefined };
  } else if (operation.action === "save") {
    if (operation.sha && recordRevision(doc.assets[savedPath]) !== operation.revision) throw createHttpError("AI classification has changed. Refresh and retry before replacing the image.", 409);
    if (!operation.sha && (source || Object.hasOwn(doc.assets, savedPath))) {
      if (operation.onConflict === "error") throw createHttpError("File already exists.", 409);
      const dot = savedPath.lastIndexOf(".");
      const stem = dot > savedPath.lastIndexOf("/") ? savedPath.slice(0, dot) : savedPath;
      const ext = dot > savedPath.lastIndexOf("/") ? savedPath.slice(dot) : "";
      let suffix = 1;
      while (entries.has(`${stem}-${suffix}${ext}`) || Object.hasOwn(doc.assets, `${stem}-${suffix}${ext}`)) suffix++;
      savedPath = `${stem}-${suffix}${ext}`;
    }
    const { data: blob } = await octokit.rest.git.createBlob({ ...ref, content: operation.content, encoding: "base64" });
    savedSha = blob.sha;
    size = Buffer.from(operation.content, "base64").length;
    changes.push({ path: savedPath, mode: "100644", type: "blob", sha: savedSha });
    const classification = operation.classification ?? "unmarked";
    if (!["generated", "modified", "unmarked"].includes(classification)) throw createHttpError("Invalid AI classification.", 400);
    if (!isLabelable(savedPath) && classification !== "unmarked") throw createHttpError("AI labels support static JPEG, PNG, WebP and AVIF only.", 400);
    const previousRecord = doc.assets[savedPath];
    if (operation.sha) deleteRecord(doc, savedPath); // Existing crops belong to the old bytes.
    if (isLabelable(savedPath)) doc.assets[savedPath] = { ...previousRecord, sourceSha256: fingerprint(Buffer.from(operation.content, "base64")), sourceGitSha: savedSha, classification, derivedFrom: undefined };
  } else if (operation.action === "rename") {
    assertRepositoryPath(operation.newPath);
    if (entries.has(operation.newPath) || operation.newPath === metadataPath) throw createHttpError("Destination already exists.", 409);
    if (isLabelable(operation.newPath)) renameRecords(doc, operation.path, operation.newPath);
    else deleteRecord(doc, operation.path);
    changes.push({ path: operation.path, mode: "100644", type: "blob", sha: null }, { path: operation.newPath, mode: "100644", type: "blob", sha: source!.sha! });
    savedPath = operation.newPath;
  } else {
    deleteRecord(doc, operation.path);
    changes.push({ path: operation.path, mode: "100644", type: "blob", sha: null });
  }
  parseMediaMetadata(doc);
  const metadataContent = `${JSON.stringify(doc, null, 2)}\n`;
  if (Buffer.byteLength(metadataContent) > 2_000_000) throw createHttpError("Media metadata exceeds 2 MB.", 413);
  const { data: metadataBlob } = await octokit.rest.git.createBlob({ ...ref, content: metadataContent, encoding: "utf-8" });
  changes.push({ path: metadataPath, mode: "100644", type: "blob", sha: metadataBlob.sha });
  const { data: nextTree } = await octokit.rest.git.createTree({ ...ref, base_tree: commit.tree.sha, tree: changes });
  const action = operation.action === "classify" ? "update" : operation.action === "save" ? (operation.sha ? "update" : "create") : operation.action;
  const message = resolveCommitMessage({ configObject, templatesOverride: options.templatesOverride, action, tokens: buildCommitTokens({ action, owner, repo, branch, path: savedPath, oldPath: operation.path, newPath: savedPath, contentName: options.contentName, user: options.user, userName: options.committer?.name, userEmail: options.committer?.email }) });
  const { data: nextCommit } = await octokit.rest.git.createCommit({ ...ref, tree: nextTree.sha, parents: [currentSha], message, committer: options.committer });
  try {
    await octokit.rest.git.updateRef({ ...ref, ref: `heads/${branch}`, sha: nextCommit.sha, force: false });
  } catch (error: any) {
    if ([409, 422].includes(error.status)) throw createHttpError("Repository changed or branch rules reject this edit. Refresh and retry on a writable branch.", 409);
    throw error;
  }
  await setBranchHeadSha(owner, repo, branch, nextCommit.sha);
  return { path: savedPath, sha: savedSha!, size, commitSha: nextCommit.sha, ai: { classification: effectiveClassification(doc, savedPath), record: doc.assets[savedPath], revision: recordRevision(doc.assets[savedPath]), stale: false } };
}
