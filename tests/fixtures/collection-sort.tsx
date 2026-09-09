import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CollectionTable } from '../../components/collection/collection-table';
import { presetColumns, presetColumnId, type SortPreset } from '../../lib/collection-sort';

const presets: SortPreset[] = [{name:'website',label:'Website-Reihenfolge',fields:[
  {field:'category',order:'asc',values:['solo','group']},{field:'year',order:'desc'},
  {field:'order',order:'asc'},{field:'id',order:'asc'},
]}];
const original = [
  ['Group newest','group',2030,1], ['Solo old','solo',2020,1],
  ['Solo ten','solo',2026,10], ['Solo two B','solo',2026,2], ['Solo two A','solo',2026,2],
].map(([title,category,year,order])=>({name:String(title),path:`${title}.json`,type:'file',fields:{title,category,year,order,id:title}}));
function Fixture(){
  const [search,setSearch] = useState('');
  const [data,setData] = useState(original);
  const [legacy,setLegacy] = useState(false);
  const visible = ['title','year','order','category'].map(field=>({id:field,accessorFn:(row:any)=>row.fields[field],header:field}));
  const columns = [...visible,...(legacy?[]:presetColumns(presets))];
  return <main className="p-6 max-w-5xl mx-auto space-y-4">
    <h1 className="text-xl font-semibold">Collection sort acceptance</h1>
    <label>Search <input className="border p-2" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <button className="border p-2" onClick={()=>setData(data=>data.map(row=>row.name==='Solo ten'?{...row,fields:{...row.fields,order:1}}:row))}>Move Solo ten first</button>
    <button className="border p-2" onClick={()=>setLegacy(!legacy)}>Toggle legacy view</button>
    <CollectionTable key={String(legacy)} columns={columns} data={data} search={search} setSearch={setSearch}
      sortPresets={legacy?[]:presets} initialState={{pagination:{pageSize:3},columnVisibility:legacy?{}:{[presetColumnId('website')]:false},sorting:[{id:legacy?'title':presetColumnId('website'),desc:false}]}}
      onExpand={async()=>{}} pathname="/" path="/" primaryField="title" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
