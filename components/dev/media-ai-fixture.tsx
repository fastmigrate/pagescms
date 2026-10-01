"use client";
import { useEffect, useState } from 'react';
import { MediaFileTile } from '@/components/media/media-view';
import { ConfigProvider } from '@/contexts/config-context';
import { MediaUpload } from '@/components/media/media-upload';
import { Toaster } from '@/components/ui/sonner';
import type { FileSaveData } from '@/types/api';
import { MediaAiDialog } from '@/components/media/media-ai-dialog';
import { Button } from '@/components/ui/button';
import type { MediaItem } from '@/types/api';
function UploadFixture() {
 const [classification,setClassification]=useState<'generated'|'modified'|'unmarked'>('unmarked');
 const [saved,setSaved]=useState<FileSaveData[]>([]);
 const config={owner:'fixture',repo:'private',branch:'main',sha:'fixture',version:'fixture',object:{mediaMetadata:'data/media.json',media:[{name:'images',input:'media',extensions:['jpg','png','svg','pdf']} ]}};
 const uploadFile=async(path:string,payload:Record<string,unknown>)=>({path,name:path.split('/').pop(),ai:{classification:payload.classification as typeof classification,revision:'saved',stale:false}});
 const props={media:'images',path:'media',classification,onClassificationChange:setClassification,uploadFile,onUpload:(item:FileSaveData)=>setSaved(previous=>[...previous,item])};
 return <ConfigProvider value={config}><section className="space-y-4" aria-label="Upload fixture"><h2>Upload paths</h2><MediaUpload {...props} showClassification={false}><MediaUpload.Trigger><Button type="button">Fixture Upload</Button></MediaUpload.Trigger></MediaUpload><MediaUpload {...props}><MediaUpload.DropZone><div data-testid="upload-drop-zone" className="border p-8">Drop fixture files</div></MediaUpload.DropZone></MediaUpload><pre data-testid="saved-uploads">{JSON.stringify(saved)}</pre></section><Toaster /></ConfigProvider>;
}
function SnapshotFixture() {
 const [changed,setChanged]=useState(false);const [simulate,setSimulate]=useState(false);
 useEffect(()=>{if(simulate){const timer=setTimeout(()=>setChanged(true),2000);return()=>clearTimeout(timer);}},[simulate]);
 const config={owner:'fixture',repo:'private',branch:'main',sha:'fixture',version:'fixture',object:{mediaMetadata:'data/media.json',media:[{name:'images',input:'media'}]}};
 const item:MediaItem={type:'file',name:'snapshot.jpg',path:'media/snapshot.jpg',extension:'jpg',sha:'blob',ai:{classification:changed?'modified':'generated',record:{classification:changed?'modified':'generated'},revision:changed?'r2':'r1',stale:false}};
 return <ConfigProvider value={config}><section data-testid="ai-snapshot" className="space-y-4"><h2>Concurrent classification</h2><label><input type="checkbox" checked={simulate} onChange={e=>setSimulate(e.target.checked)} />Autorefresh simulieren</label><p data-testid="current-revision">{item.ai!.revision}</p><div className="max-w-56"><MediaFileTile item={item} mediaName="images" selectable={false} isSelected={false} isImage={false} displaySize="Fixture" portalContainer={null} onSelect={()=>{}} onDelete={()=>{}} onRename={()=>{}} classify={async(displayed,selection)=>{if(displayed.ai?.revision!==item.ai!.revision)throw new Error('AI classification has changed. Refresh and retry.');return {...item.ai!,classification:selection.classification??'generated'};}} /></div></section></ConfigProvider>;
}
export function MediaAiFixture() {
  const [open, setOpen] = useState(false);
  const [fail, setFail] = useState(false);
  const [ai, setAi] = useState<NonNullable<MediaItem['ai']>>({classification:'unmarked',revision:'fixture',stale:false});
  const item: MediaItem = {type:'file',name:'recipe.jpg',path:'website/src/assets/media/recipe.jpg',sha:'fixture',ai};
  return <main className="mx-auto max-w-xl space-y-6 p-8"><h1 className="text-2xl font-semibold">AI-Kennzeichnung</h1><p>Entwicklungsfixture mit dem produktiven Dialog und ohne externe Schreibzugriffe.</p><p data-testid="saved-classification">{ai.classification}</p><label className="flex gap-2"><input name="simulate-error" type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Speicherfehler simulieren</label><Button type="button" onClick={() => setOpen(true)}>AI-Kennzeichnung bearbeiten</Button>{open && <MediaAiDialog sourcePicker={select => <Button type="button" variant="outline" onClick={() => select("website/src/assets/media/original.jpg")}>Originalbild auswählen</Button>} item={item} open={open} onOpenChange={setOpen} onSaved={setAi} save={async selection => {if(fail) throw new Error('Repository changed. Refresh and retry.'); if(selection.derivedFrom && !selection.derivedFrom.endsWith('original.jpg')) throw new Error('Derivative source not found.'); return {classification:selection.classification ?? 'generated',record:selection,revision:'new',stale:false};}} />}<UploadFixture /><SnapshotFixture /></main>;
}
