import { getFileExtension } from "@/lib/utils/file";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { createHttpError } from "@/lib/api-error";
import { allocateFilePath, gitBlobSha, mutateBranch, requireSource, type BranchSnapshot, type FileChange } from "@/lib/github-branch-mutation";
import { buildCommitTokens, resolveCommitIdentity, resolveCommitMessage } from "@/lib/commit-message";
import { assertRepositoryPath, withinMedia, deleteRecord, effectiveClassification, fingerprint, isLabelable, parseMediaMetadata, recordRevision, renameRecords, type Classification, type MediaMetadata } from "@/lib/media-metadata";

type Ref = { owner: string; repo: string; branch: string };
type Options = Ref & { token: string; configObject?: Record<string, any>; editor?: { name?: string | null; email?: string | null }; committer?: { name: string; email: string }; templatesOverride?: Record<string, string>; contentName?: string; user?: string };
type Operation =
  | { action: "classify"; path: string; sha: string; classification: Classification; revision: string }
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

// Bind each source classification to one fresh Git snapshot.
export async function readMediaMetadataStatus(token: string, ref: Ref, metadataPath: string) {
  const octokit = createOctokitInstance(token);
  const repository = {owner: ref.owner, repo: ref.repo};
  const {data: head} = await octokit.rest.git.getRef({...repository, ref: `heads/${ref.branch}`});
  const {data: commit} = await octokit.rest.git.getCommit({...repository, commit_sha: head.object.sha});
  const [metadata, {data: tree}] = await Promise.all([
    readMediaMetadata(token, {...ref, branch: head.object.sha}, metadataPath),
    octokit.rest.git.getTree({...repository, tree_sha: commit.tree.sha, recursive: 'true'}),
  ]);
  // A truncated tree cannot prove that an omitted source is unchanged.
  const sources = new Map(tree.tree.filter(entry => entry.type === 'blob' && entry.mode !== '120000').map(entry => [entry.path!, entry.sha]));
  const stale = new Map<string, boolean>();
  for (const [path, record] of Object.entries(metadata.assets)) {
    stale.set(path, !record.sourceGitSha || sources.get(path) !== record.sourceGitSha);
  }
  return {metadata, stale, sources};
}

export async function prepareMediaMetadata(snapshot: BranchSnapshot, operation: Operation) {
  const configObject = snapshot.configObject;
  if ((operation.action === "classify" || operation.action === "save") && Object.hasOwn(operation, "derivedFrom")) throw createHttpError("Manual media variants are not supported.", 400);
  const metadataPath = configObject.mediaMetadata;
  assertRepositoryPath(metadataPath);
  assertRepositoryPath(operation.path);
  if (operation.path === metadataPath) throw createHttpError("Metadata cannot be edited as a media file.", 400);
  const entries = snapshot.entries;
  const source = entries.get(operation.path);
  if (operation.action !== "save" || source) requireSource(snapshot, operation.path, operation.sha);
  if (operation.action === "rename" && !operation.sha) throw createHttpError("Source SHA is required for media rename.", 400);
  if (operation.sha && operation.sha !== source?.sha) throw createHttpError("File has changed since you last loaded it. Keep your draft, reload the file and retry.", 409);
  let doc: MediaMetadata = { version: 1, assets: {} };
  const metadataEntry = entries.get(metadataPath);
  if (metadataEntry) {
    if (metadataEntry.type !== "blob" || metadataEntry.mode === "120000") throw createHttpError("Invalid metadata file.", 400);
    const bytes = await snapshot.readFile(metadataPath);
    if (bytes.length > 2_000_000) throw createHttpError("Media metadata exceeds 2 MB.", 413);
    doc = parseMediaMetadata(JSON.parse(bytes.toString("utf8")));
  }
  const changes: FileChange[] = [];
  let savedPath = operation.path;
  let savedSha = source?.sha;
  let size = source?.size;
  if (operation.action === "classify") {
    if (!isLabelable(savedPath)) throw createHttpError("AI labels support static JPEG, PNG, WebP and AVIF only.", 400);
    if (recordRevision(doc.assets[savedPath]) !== operation.revision) throw createHttpError("AI classification has changed. Refresh and retry.", 409);
    if (!["generated", "modified", "unmarked"].includes(operation.classification)) throw createHttpError("An explicit AI classification is required; manual variants are not supported.", 400);
    const previousRecord = doc.assets[savedPath];
    const currentFingerprint = fingerprint(await snapshot.readFile(operation.path));
    doc.assets[savedPath] = { ...previousRecord, sourceSha256: currentFingerprint, sourceGitSha: source!.sha!, classification: operation.classification };
  } else if (operation.action === "save") {
    if (operation.sha && (isLabelable(savedPath) || Object.hasOwn(doc.assets, savedPath)) && recordRevision(doc.assets[savedPath]) !== operation.revision) throw createHttpError("AI classification has changed. Refresh and retry before replacing the image.", 409);
    if (!operation.sha && (source || Object.hasOwn(doc.assets, savedPath))) {
      if (operation.onConflict === "error") throw createHttpError("File already exists.", 409);
      savedPath = allocateFilePath(savedPath, path => entries.has(path) || Object.hasOwn(doc.assets, path));
    }
    const bytes = Buffer.from(operation.content, "base64");
    savedSha = gitBlobSha(bytes);
    size = bytes.length;
    changes.push({ action: "put", path: savedPath, content: bytes });
    const classification = operation.classification ?? "unmarked";
    if (!["generated", "modified", "unmarked"].includes(classification)) throw createHttpError("Invalid AI classification.", 400);
    if (!isLabelable(savedPath) && classification !== "unmarked") throw createHttpError("AI labels support static JPEG, PNG, WebP and AVIF only.", 400);
    const previousRecord = doc.assets[savedPath];
    if (operation.sha && !isLabelable(savedPath)) deleteRecord(doc, savedPath);
    if (isLabelable(savedPath)) doc.assets[savedPath] = { ...previousRecord, sourceSha256: fingerprint(Buffer.from(operation.content, "base64")), sourceGitSha: savedSha, classification };
  } else if (operation.action === "rename") {
    assertRepositoryPath(operation.newPath);
    if (entries.has(operation.newPath) || operation.newPath === metadataPath) throw createHttpError("Destination already exists.", 409);
    if (isLabelable(operation.newPath)) renameRecords(doc, operation.path, operation.newPath);
    else deleteRecord(doc, operation.path);
    changes.push({ action: "remove", path: operation.path }, { action: "copy", path: operation.newPath, sha: source!.sha!, mode: source!.mode as "100644" | "100755" });
    savedPath = operation.newPath;
  } else {
    deleteRecord(doc, operation.path);
    changes.push({ action: "remove", path: operation.path });
  }
  parseMediaMetadata(doc);
  const metadataContent = `${JSON.stringify(doc, null, 2)}\n`;
  if (Buffer.byteLength(metadataContent) > 2_000_000) throw createHttpError("Media metadata exceeds 2 MB.", 413);
  changes.push({ action: "put", path: metadataPath, content: Buffer.from(metadataContent) });
  return { changes, path: savedPath, sha: savedSha!, size, ai: { classification: effectiveClassification(doc, savedPath), record: doc.assets[savedPath], revision: recordRevision(doc.assets[savedPath]), stale: false } };
}

export async function mutateMediaMetadata(options: Options, operation: Operation) {
  return mutateBranch(options, async snapshot => {
    const configObject = snapshot.configObject;
    const media = configObject.media?.find((source: any) => source.name === options.contentName);
    if (!media || !withinMedia(operation.path, media.input)) throw createHttpError("Invalid media path.", 400);
    if (media.extensions?.length && !media.extensions.includes(getFileExtension(operation.path))) throw createHttpError("Invalid extension for media.", 400);
    const identity = resolveCommitIdentity({ configObject, identityOverride: media.commit?.identity });
    const committer = identity === "user" && options.editor?.email ? { name: options.editor.name?.trim() || options.editor.email, email: options.editor.email } : identity === "user" ? options.committer : undefined;
    const prepared = await prepareMediaMetadata(snapshot, operation);
    const action = operation.action === "classify" ? "update" : operation.action === "save" ? (operation.sha ? "update" : "create") : operation.action;
    const message = resolveCommitMessage({ configObject, templatesOverride: media.commit?.templates, action, tokens: buildCommitTokens({ action, owner: options.owner, repo: options.repo, branch: options.branch, path: prepared.path, oldPath: operation.path, newPath: prepared.path, contentName: options.contentName, user: options.user, userName: committer?.name, userEmail: committer?.email }) });
    return { changes: prepared.changes, result: prepared, message, committer };
  });
}
