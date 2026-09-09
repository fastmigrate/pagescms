export type ReferenceImage = { path: string; media: string };

// Values have already passed through the image field's read transform, so the
// path points into the repository (not the website's public media directory).
export function referenceImage(value: unknown, media: unknown): ReferenceImage | null {
  const path = Array.isArray(value) ? value[0] : value;
  if (typeof path !== "string" || !path.trim() || typeof media !== "string" || !media) return null;
  // Thumbnail resolves repository media through the existing authenticated API.
  // External images and malformed values retain the text-only fallback.
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return null;
  return { path, media };
}
