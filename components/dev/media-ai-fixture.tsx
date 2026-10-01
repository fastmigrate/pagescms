"use client";
import { useState } from 'react';
import { MediaAiDialog } from '@/components/media/media-ai-dialog';
import { Button } from '@/components/ui/button';
import type { MediaItem } from '@/types/api';
export function MediaAiFixture() {
  const [open, setOpen] = useState(false);
  const [fail, setFail] = useState(false);
  const [ai, setAi] = useState<NonNullable<MediaItem['ai']>>({classification:'unmarked',revision:'fixture',stale:false});
  const item: MediaItem = {type:'file',name:'recipe.jpg',path:'website/src/assets/media/recipe.jpg',sha:'fixture',ai};
  return <main className="mx-auto max-w-xl space-y-6 p-8"><h1 className="text-2xl font-semibold">AI-Kennzeichnung</h1><p>Entwicklungsfixture mit dem produktiven Dialog und ohne externe Schreibzugriffe.</p><p data-testid="saved-classification">{ai.classification}</p><label className="flex gap-2"><input name="simulate-error" type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Speicherfehler simulieren</label><Button type="button" onClick={() => setOpen(true)}>AI-Kennzeichnung bearbeiten</Button>{open && <MediaAiDialog sourcePicker={select => <Button type="button" variant="outline" onClick={() => select("website/src/assets/media/original.jpg")}>Originalbild auswählen</Button>} item={item} open={open} onOpenChange={setOpen} onSaved={setAi} save={async selection => {if(fail) throw new Error('Repository changed. Refresh and retry.'); if(selection.derivedFrom && !selection.derivedFrom.endsWith('original.jpg')) throw new Error('Derivative source not found.'); return {classification:selection.classification ?? 'generated',record:selection,revision:'new',stale:false};}} />}</main>;
}
