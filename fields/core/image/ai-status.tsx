"use client";

import useSWR from "swr";
import { useConfig } from "@/contexts/config-context";
import { requireApiSuccess } from "@/lib/api-client";
import { getParentPath } from "@/lib/utils/file";
import type { MediaItem } from "@/types/api";

async function fetchMedia(url: string): Promise<MediaItem[]> {
  const response = await fetch(url);
  const payload = await requireApiSuccess<{ data: MediaItem[] }>(response, "Failed to fetch media");
  return payload.data;
}

export function ImageAiStatus({ path, media }: { path: string; media: string }) {
  const { config } = useConfig();
  const enabled = Boolean(config?.object.mediaMetadata);
  const key = enabled && config
    ? `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/media/${encodeURIComponent(media)}/${encodeURIComponent(getParentPath(path) || "/")}`
    : null;
  const { data, error, isLoading } = useSWR(key, fetchMedia);
  if (!enabled) return null;
  const ai = data?.find(item => item.type === "file" && item.path === path)?.ai;
  const label = error
    ? "AI-Status nicht verfügbar"
    : isLoading || !data
      ? "AI-Status wird geladen …"
      : !ai
        ? "AI-Status nicht verfügbar"
        : ai.stale
          ? "AI: erneut prüfen"
          : ai.classification === "generated"
            ? "AI GENERATED"
            : ai.classification === "modified"
              ? "AI MODIFIED"
              : "Keine Kennzeichnung";
  return <p role="status" aria-label={`AI-Status ${path}`} className="text-xs text-muted-foreground">{label}</p>;
}
