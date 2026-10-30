import { createHash } from "node:crypto";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { createHttpError } from "@/lib/api-error";
import { normalizeConfig, parseAndValidateConfig } from "@/lib/config";
import { assertRepositoryPath } from "@/lib/media-metadata";
import { assertMediaReferenceSafety } from "@/lib/media-references";
import { clearFileCache, setBranchHeadSha } from "@/lib/github-cache-file";
import { getFolderPathsForChanges, invalidateFolderScopes } from "@/lib/github-cache-folders";

export type FileChange =
  | { action: "put"; path: string; content: Buffer }
  | { action: "copy"; path: string; sha: string; mode?: "100644" | "100755" }
  | { action: "remove"; path: string };

export type BranchTreeEntry = { path: string; sha?: string; type?: string; mode?: string; size?: number };
export type BranchSnapshot = {
  head: string;
  treeSha: string;
  configSha: string;
  configObject: Record<string, any>;
  entries: ReadonlyMap<string, BranchTreeEntry>;
  readBlob: (sha: string) => Promise<Buffer>;
  readFile: (path: string) => Promise<Buffer>;
};
type BranchContext = { token: string; owner: string; repo: string; branch: string };
type FilePlan<T> = { changes: FileChange[]; result: T; message: string; committer?: { name: string; email: string } };

export function gitBlobSha(content: Buffer) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

export function requireSource(snapshot: BranchSnapshot, path: string, sha?: string) {
  assertRepositoryPath(path);
  const entry = snapshot.entries.get(path);
  if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode || "") || !entry.sha) {
    throw createHttpError(`File "${path}" not found or is not a regular file.`, 404);
  }
  if (sha && entry.sha !== sha) throw createHttpError("File has changed since you last loaded it. Keep your draft, reload the file and retry.", 409);
  return entry;
}

export function allocateFilePath(path: string, occupied: (path: string) => boolean) {
  if (!occupied(path)) return path;
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > path.lastIndexOf("/") + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : "";
  let suffix = 1;
  while (occupied(`${stem}-${suffix}${extension}`)) suffix++;
  return `${stem}-${suffix}${extension}`;
}

export async function mutateBranch<T>(options: BranchContext, prepare: (snapshot: BranchSnapshot) => Promise<FilePlan<T>>) {
  const { owner, repo, branch, token } = options;
  const ref = { owner, repo };
  const octokit = createOctokitInstance(token, { retry: { doNotRetry: [409, 422] } });
  const { data: head } = await octokit.rest.git.getRef({ ...ref, ref: `heads/${branch}` });
  const { data: commit } = await octokit.rest.git.getCommit({ ...ref, commit_sha: head.object.sha });
  const { data: tree } = await octokit.rest.git.getTree({ ...ref, tree_sha: commit.tree.sha, recursive: "true" });
  if (tree.truncated) throw createHttpError("The complete repository tree is unavailable. No files were changed; retry after reducing the repository size.", 413);
  const entries = new Map<string, BranchTreeEntry>();
  for (const entry of tree.tree) {
    if (!entry.path || !entry.sha || !entry.type || !entry.mode) throw createHttpError("Incomplete repository tree. No files were changed.", 502);
    entries.set(entry.path, { ...entry, path: entry.path });
  }
  const blobs = new Map<string, Promise<Buffer>>();
  let totalBytes = 0;
  const readBlob = (sha: string) => {
    if (!blobs.has(sha)) blobs.set(sha, (async () => {
      const { data } = await octokit.rest.git.getBlob({ ...ref, file_sha: sha });
      if (data.encoding !== "base64" || typeof data.content !== "string") throw createHttpError("Repository file bytes are unavailable. No files were changed.", 502);
      if ((data.size ?? 0) > 10 * 1024 * 1024 || data.content.length > 14 * 1024 * 1024) throw createHttpError("A repository file exceeds the supported scan size. No files were changed.", 413);
      const bytes = Buffer.from(data.content, "base64");
      if (data.size != null && bytes.length !== data.size) throw createHttpError("Incomplete repository file. No files were changed.", 502);
      totalBytes += bytes.length;
      if (totalBytes > 50 * 1024 * 1024) throw createHttpError("The reference scan exceeds 50 MB. No files were changed.", 413);
      return bytes;
    })());
    return blobs.get(sha)!;
  };
  const snapshot: BranchSnapshot = {
    head: head.object.sha, treeSha: commit.tree.sha, configSha: "", configObject: {}, entries, readBlob,
    readFile: path => readBlob(requireSource(snapshot, path).sha!),
  };
  const configEntry = requireSource(snapshot, ".pages.yml");
  snapshot.configSha = configEntry.sha!;
  const config = parseAndValidateConfig((await snapshot.readFile(".pages.yml")).toString("utf8"));
  if (config.parseErrors.length || config.validationErrors.some(error => error.severity === "error")) {
    throw createHttpError("Repository configuration is invalid. No files were changed.", 400);
  }
  snapshot.configObject = normalizeConfig(config.document.toJSON());
  const plan = await prepare(snapshot);
  const changedPaths = new Set<string>();
  for (const change of plan.changes) {
    assertRepositoryPath(change.path);
    if (changedPaths.has(change.path)) throw createHttpError("Conflicting changes to the same repository file.", 400);
    changedPaths.add(change.path);
    if (change.path === ".pages.yml") throw createHttpError("Configuration writes use the settings editor.", 400);
    if (change.action === "remove") requireSource(snapshot, change.path);
    if (change.action === "copy" && ![...entries.values()].some(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode || "") && entry.sha === change.sha)) {
      throw createHttpError("Copy source is not a regular repository file.", 400);
    }
  }
  await assertMediaReferenceSafety({ configObject: snapshot.configObject, entries, changes: plan.changes, readBlob });
  const delta: { path: string; mode: "100644" | "100755"; type: "blob"; sha: string | null }[] = [];
  const files = new Map<string, { sha: string; size?: number }>();
  for (const change of plan.changes) {
    let sha: string | null = null;
    if (change.action === "put") {
      const expectedSha = gitBlobSha(change.content);
      const { data: blob } = await octokit.rest.git.createBlob({ ...ref, content: change.content.toString("base64"), encoding: "base64" });
      if (blob.sha !== expectedSha) throw createHttpError("GitHub returned an unexpected file fingerprint. No branch changes were published.", 502);
      sha = blob.sha;
      files.set(change.path, { sha, size: change.content.length });
    } else if (change.action === "copy") {
      sha = change.sha;
      files.set(change.path, { sha, size: [...entries.values()].find(entry => entry.sha === sha)?.size });
    }
    delta.push({ path: change.path, mode: (change.action === "copy" ? change.mode : entries.get(change.path)?.mode) === "100755" ? "100755" : "100644", type: "blob", sha });
  }
  const { data: nextTree } = await octokit.rest.git.createTree({ ...ref, base_tree: snapshot.treeSha, tree: delta });
  const { data: nextCommit } = await octokit.rest.git.createCommit({ ...ref, tree: nextTree.sha, parents: [snapshot.head], message: plan.message, committer: plan.committer });
  try {
    await octokit.rest.git.updateRef({ ...ref, ref: `heads/${branch}`, sha: nextCommit.sha, force: false });
  } catch (error: any) {
    if ([409, 422].includes(error.status)) throw createHttpError("Repository changed or branch rules rejected this edit. Your draft is unchanged. Retry against the latest repository state on a writable branch.", 409);
    throw error;
  }
  try {
    await setBranchHeadSha(owner, repo, branch, nextCommit.sha);
    await invalidateFolderScopes(owner, repo, branch, getFolderPathsForChanges([...changedPaths]));
  } catch (error) {
    console.error("Files saved, but cache refresh failed.", error);
    try { await clearFileCache(owner, repo, branch); }
    catch (cacheError) { console.error("File cache invalidation failed.", cacheError); }
  }
  return { ...plan.result, files, commitSha: nextCommit.sha };
}
