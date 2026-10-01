"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MediaItem } from "@/types/api";

type Selection = { classification?: "generated" | "modified" | "unmarked"; derivedFrom?: string };
export function MediaAiDialog({ item, open, onOpenChange, save, onSaved, sourcePicker }: { item: MediaItem; open: boolean; onOpenChange: (open: boolean) => void; save: (value: Selection) => Promise<NonNullable<MediaItem['ai']>>; onSaved: (ai: NonNullable<MediaItem['ai']>) => void; sourcePicker?: (select: (path: string) => void) => React.ReactNode }) {
  const id = useId();
  const [choice, setChoice] = useState(item.ai?.record?.derivedFrom && !item.ai.record.classification ? "inherit" : item.ai?.record?.classification ?? "unmarked");
  const [source, setSource] = useState(item.ai?.record?.derivedFrom ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await save(choice === "inherit" ? { derivedFrom: source.trim() } : { classification: choice as Selection['classification'] });
      onSaved(result); onOpenChange(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}><DialogContent>
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader><DialogTitle>AI-Kennzeichnung</DialogTitle><DialogDescription>{item.name} — gilt für alle daraus erzeugten Größen und Formate.</DialogDescription></DialogHeader>
      {item.ai?.stale && <p role="status" className="text-sm text-destructive">Die Kennzeichnung lässt sich für den aktuellen Bildstand nicht bestätigen. Bitte erneut prüfen.</p>}
      <fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Bildherkunft</legend>
        {[['unmarked','Keine Kennzeichnung'],['generated','AI GENERATED — mit KI erzeugt'],['modified','AI MODIFIED — mit KI verändert'],['inherit','Variante eines anderen Bildes']].map(([value,label]) => <label key={value} className="flex items-center gap-3 text-sm"><input type="radio" name={id} value={value} checked={choice === value} onChange={() => setChoice(value)} />{label}</label>)}
        {choice === 'inherit' && <div className="space-y-2"><label htmlFor={`${id}-source`} className="text-sm">Originalbild</label><Input id={`${id}-source`} name="derivedFrom" value={source} onChange={e => setSource(e.target.value)} required readOnly={!!sourcePicker} placeholder="website/src/assets/media/original.jpg" />{sourcePicker?.(setSource)}<p className="text-xs text-muted-foreground">Übernimmt dessen Kennzeichnung. Das Original muss bereits eingeordnet sein.</p></div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
