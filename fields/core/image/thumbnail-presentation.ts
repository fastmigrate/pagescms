const sizes = { small: "w-8", medium: "w-16", large: "w-24" } as const;

/** Collection thumbnails only; invalid options retain the compact default. */
export function thumbnailPresentation(options?: Record<string, unknown> | null) {
  const size = options?.thumbnailSize;
  return {
    className: typeof size === "string" && Object.hasOwn(sizes, size)
      ? sizes[size as keyof typeof sizes]
      : sizes.small,
    fit: options?.thumbnailFit === "contain" ? "contain" as const : "cover" as const,
  };
}
