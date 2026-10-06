"use client";
import { useConfig } from "@/contexts/config-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ConfigurationNotice({ getDraft, filename, disabled = false, onUpdate }: {
  getDraft: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  filename: string;
  disabled?: boolean;
  onUpdate?: () => void;
}) {
  const { pendingConfig, applyPendingConfig } = useConfig();
  if (pendingConfig === undefined) return null;
  const update = async () => {
    let draft;
    try { draft = await getDraft(); } catch {
      toast.error("Could not download the draft. Your edits are kept.");
      return;
    }
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}.draft.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onUpdate?.();
    applyPendingConfig();
  };
  return <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
    <p className="text-sm">Configuration changed. Your unsaved edits are kept. Download your draft before loading the updated fields.</p>
    <Button type="button" variant="outline" disabled={disabled} onClick={update}>Download draft and update fields</Button>
  </div>;
}
