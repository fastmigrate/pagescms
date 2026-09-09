"use client";

import { useState, useEffect } from "react";
import { getRawUrl } from "@/lib/github-image";
import { useRepo } from "@/contexts/repo-context";
import { useConfig } from "@/contexts/config-context";
import { cn } from "@/lib/utils";
import { ImageOff, Loader } from "lucide-react";

export function Thumbnail({
  name,
  path,
  className,
  fit = "cover"
}: {
  name: string,
  path: string | null;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const [result, setResult] = useState<{ key: string; url: string | null; error: boolean } | null>(null);
  const { owner, repo, isPrivate } = useRepo();
  const { config } = useConfig();
  const branch = config?.branch!;
  const requestKey = JSON.stringify([owner, repo, branch, name, path, isPrivate]);
  const current = result?.key === requestKey ? result : null;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setResult({ key: requestKey, url: null, error: false });
    const fetchRawUrl = async () => {
      try {
        const url = await getRawUrl(owner, repo, branch, name, path, isPrivate);
        if (!cancelled) setResult({ key: requestKey, url: url || null, error: !url });
      } catch (error) {
        console.warn(error instanceof Error ? error.message : "Image unavailable");
        if (!cancelled) setResult({ key: requestKey, url: null, error: true });
      }
    };
    void fetchRawUrl();
    return () => { cancelled = true; };
  }, [path, owner, repo, branch, isPrivate, name, requestKey]);

  return (
    <div
      className={cn(
        "bg-muted w-full aspect-square overflow-hidden relative",
        className
      )}
    >
      {path
        ? current?.url
          ? <img
              key={requestKey}
              src={current.url}
              onError={() => setResult(previous => previous?.key === requestKey
                ? { key: requestKey, url: null, error: true }
                : previous)}
              alt={path.split("/").pop() || "thumbnail"}
              loading="lazy"
              className={cn("absolute inset-0 w-full h-full", fit === "contain" ? "object-contain" : "object-cover")}
            />
          : current?.error
            ? <div className="flex justify-center items-center absolute inset-0 text-muted-foreground" role="img" aria-label="Image unavailable" title="Image unavailable">
                <ImageOff className="h-4 w-4"/>
              </div>
            : <div className="flex justify-center items-center absolute inset-0 text-muted-foreground" title="Loading...">
                <Loader className="h-4 w-4 animate-spin"/>
              </div>
        : <div className="flex justify-center items-center absolute inset-0 text-muted-foreground" title="No image">
            <ImageOff className="h-4 w-4"/>
          </div>
      }
    </div>
  );
};
