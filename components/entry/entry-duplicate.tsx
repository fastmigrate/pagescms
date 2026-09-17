"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { requireApiSuccess } from "@/lib/api-client";
import { resolveDuplicateOperation } from "@/lib/duplicate-entry";
import { getFieldByPath, getPrimaryField } from "@/lib/schema";
import type { ApiSuccess, EntryData } from "@/types/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EntryDuplicate({
  owner,
  repo,
  branch,
  name,
  path,
  schema,
  disabled,
  duplicateEntry,
  onDuplicated,
}: {
  owner: string;
  repo: string;
  branch: string;
  name: string;
  path: string;
  schema: Record<string, any>;
  disabled?: boolean;
  duplicateEntry?: (value: string) => Promise<ApiSuccess<EntryData>>;
  onDuplicated?: (response: ApiSuccess<EntryData>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isDuplicating, setIsDuplicating] = useState(false);
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const primaryField = useMemo(() => getPrimaryField(schema), [schema]);
  const operation = useMemo(
    () => resolveDuplicateOperation(schema, primaryField),
    [primaryField, schema],
  );
  const field = useMemo(
    () => operation ? getFieldByPath(schema.fields ?? [], operation.field) : undefined,
    [operation, schema.fields],
  );

  if (!operation || !field) return null;

  const encodedBranch = encodeURIComponent(branch);
  const fieldLabel = operation.fieldLabel || `New ${field.label || field.name}`;
  const trimmedValue = value.trim();

  const handleOpenChange = (nextOpen: boolean) => {
    if (isDuplicating) return;
    setOpen(nextOpen);
    if (!nextOpen) setValue("");
  };

  const handleDuplicate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedValue || isDuplicating) return;

    setIsDuplicating(true);
    const duplicatePromise = duplicateEntry
      ? duplicateEntry(trimmedValue)
      : (async (): Promise<ApiSuccess<EntryData>> => {
      const response = await fetch(
        `/api/${owner}/${repo}/${encodedBranch}/files/${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "content",
            name,
            duplicate: { value: trimmedValue },
            onConflict: "error",
          }),
        },
      );
      return requireApiSuccess<ApiSuccess<EntryData>>(
        response,
        "Failed to duplicate entry",
      );
    })();

    toast.promise(duplicatePromise, {
      loading: "Duplicating entry",
      success: (response) => response.message,
      error: (error: unknown) => error instanceof Error ? error.message : "Failed to duplicate entry.",
    });

    try {
      const response = await duplicatePromise;
      const collectionKeyPrefix = `/api/${owner}/${repo}/${encodedBranch}/collections/${encodeURIComponent(name)}?`;
      void mutate((key) => typeof key === "string" && key.startsWith(collectionKeyPrefix));
      setOpen(false);
      setValue("");
      if (onDuplicated) {
        onDuplicated(response);
      } else {
        router.push(`/${owner}/${repo}/${encodedBranch}/collection/${encodeURIComponent(name)}/edit/${encodeURIComponent(response.data.path)}`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsDuplicating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || isDuplicating} aria-label={operation.label}>
          <Copy className="size-4 sm:hidden" />
          <span className="hidden sm:inline">{operation.label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleDuplicate}>
          <DialogHeader>
            <DialogTitle>{operation.label}</DialogTitle>
            <DialogDescription>
              {operation.description}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="duplicate-entry-value">{fieldLabel}</Label>
            <Input
              id="duplicate-entry-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
              required
              disabled={isDuplicating}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isDuplicating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmedValue || isDuplicating}>
              {operation.button}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
