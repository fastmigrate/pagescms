// Decimal MB, matching the limit shown to editors. Base64 plus JSON fits in 10 MiB.
export const MAX_UPLOAD_BYTES = 7_500_000;
export const MAX_FILE_REQUEST_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TOO_LARGE = "File is too large. Maximum upload size is 7.5 MB per file. Please choose a smaller file.";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export function assertUploadSize(size: number) {
  if (size > MAX_UPLOAD_BYTES) fail(UPLOAD_TOO_LARGE, 413);
}

export function assertMediaContent(content: unknown): asserts content is string {
  if (typeof content !== "string") fail("Invalid media content.", 400);
  // Reject excess encoded data before scanning or decoding it.
  if (content.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) fail(UPLOAD_TOO_LARGE, 413);
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    fail("Invalid media content.", 400);
  }
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  assertUploadSize(content.length / 4 * 3 - padding);
}

// File writes bypass Next's body-cloning proxy. Keep its existing same-origin
// check here for BOTH methods, and apply the byte limit while reading below.
export function assertFileWriteOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let allowed = false;
  try { allowed = !!origin && !!host && new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch {}
  if (!allowed) fail("Forbidden.", 403);
}

export async function readFileRequest(request: Request): Promise<any> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_FILE_REQUEST_BYTES) fail(UPLOAD_TOO_LARGE, 413);
  const reader = request.body?.getReader();
  if (!reader) fail("Invalid or incomplete upload request.", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_REQUEST_BYTES) {
        await reader.cancel();
        fail(UPLOAD_TOO_LARGE, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail("Invalid or incomplete upload request. Please try again.", 400); }
}
