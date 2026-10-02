import { createHash } from "node:crypto";

export type Classification = "generated" | "modified" | "unmarked";
export type AssetRecord = {
  classification: Classification;
  sourceSha256: string;
  sourceGitSha?: string;
  [key: string]: unknown;
};
export type MediaMetadata = { version: 1; assets: Record<string, AssetRecord>; [key: string]: unknown };
export const labelableExtensions = ["jpg", "jpeg", "png", "webp", "avif"];
const reserved = new Set(["__proto__", "constructor", "prototype"]);

export function assertRepositoryPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === ".." || reserved.has(p))) {
    throw new Error("Invalid repository-relative media path.");
  }
}
export function withinMedia(path: string, root: string) {
  return !root || path === root || path.startsWith(`${root}/`);
}
export function isLabelable(path: string) {
  return labelableExtensions.includes(path.split(".").pop()?.toLowerCase() ?? "");
}
export function parseMediaMetadata(value: unknown): MediaMetadata {
  const doc = value as MediaMetadata;
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.version !== 1 || !doc.assets || typeof doc.assets !== "object" || Array.isArray(doc.assets)) throw new Error("Invalid media metadata version or assets.");
  for (const [path, record] of Object.entries(doc.assets)) {
    assertRepositoryPath(path);
    if (!record || typeof record !== "object" || Array.isArray(record) || !/^[a-f0-9]{64}$/.test(record.sourceSha256)) throw new Error(`Invalid media fingerprint: ${path}`);
    if (record.sourceGitSha !== undefined && !/^[a-f0-9]{40}$/.test(record.sourceGitSha)) throw new Error(`Invalid Git fingerprint: ${path}`);
    if (!["generated", "modified", "unmarked"].includes(record.classification)) throw new Error(`Invalid or missing classification: ${path}`);
    if (Object.hasOwn(record, "derivedFrom")) throw new Error(`Manual media derivation is not supported: ${path}`);
    if (!isLabelable(path)) throw new Error(`AI labels support static JPEG, PNG, WebP and AVIF only: ${path}`);
  }
  return doc;
}
export function effectiveClassification(doc: MediaMetadata, path: string): Classification {
  return Object.hasOwn(doc.assets, path) ? doc.assets[path].classification : "unmarked";
}
export function fingerprint(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function recordRevision(record?: AssetRecord) {
  return fingerprint(JSON.stringify(record ?? null));
}
export function renameRecords(doc: MediaMetadata, from: string, to: string) {
  if (Object.hasOwn(doc.assets, to)) throw new Error("Destination metadata already exists.");
  if (Object.hasOwn(doc.assets, from)) { doc.assets[to] = doc.assets[from]; delete doc.assets[from]; }
}
export function deleteRecord(doc: MediaMetadata, path: string) {
  delete doc.assets[path];
}
