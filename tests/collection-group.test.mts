import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTable, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel } from "@tanstack/react-table";
import { collectionSections, resolveCollectionGrouping } from "../lib/collection-group.ts";
import { presetColumnId, presetColumns, type SortPreset } from "../lib/collection-sort.ts";
import { productionLoader } from "./helpers/cms-git-fixture.mts";

const load = productionLoader({"@/fields/registry":{
  fieldTypes:new Set(['string','select','date','object']), defaultValues:{}, schemas:{},
}});
const { normalizeConfig } = load("lib/config.ts");
const { getFieldByPath, safeAccess } = load("lib/schema.ts");
const { CollectionTable } = load("components/collection/collection-table.tsx");
const preset: SortPreset = {name:'website',label:'Website',fields:[
  {field:'meta.section',order:'asc',values:['press','tv']},
  {field:'publishedDate',order:'desc'},
]};
const normalized = normalizeConfig({
  components:{section:{component:'base'},base:{type:'select',options:{values:[{name:'press',label:'Presse'},{value:'tv',label:'TV'},'radio']}}},
  content:[{name:'press',type:'collection',path:'content/press',subfolders:false,
    fields:[{name:'meta',type:'object',fields:[{name:'section',component:'section',options:{placeholder:'Bereich'}}]}],
    view:{groupBy:'meta.section',sortPresets:[preset],default:{sortPreset:'website'}},
  }],
}).content[0];
const grouping = resolveCollectionGrouping(normalized.view.groupBy,getFieldByPath(normalized.fields,normalized.view.groupBy))!;
const entry = (title: string, section: unknown, publishedDate: string) => ({
  name:title, path:`${title}.json`, type:'file' as const, fields:{title,meta:{section},publishedDate},
});
const entries = [
  entry('Besuchergruppe aus der Region','press','2024-11-29'),
  entry('Erbseneintopf im Fernsehbeitrag','tv','2025-05-18'),
  entry('Hühnersuppe im Fernsehbeitrag','tv','2025-04-27'),
  entry('Manufaktur feiert Betriebsjubiläum','press','2025-06-02'),
  entry('Rinderfond im Produkttest','press','2024-11-14'),
];
const visibleColumns = ['title','publishedDate'].map(field => ({id:field,header:field,accessorFn:(row:any)=>row.fields[field]}));
const initialState = {sorting:[{id:presetColumnId('website'),desc:false}],columnVisibility:{[presetColumnId('website')]:false},pagination:{pageIndex:0,pageSize:25}};
function render(options: Record<string,any> = {}) {
  return renderToStaticMarkup(createElement(CollectionTable,{
    columns:[...visibleColumns,...presetColumns([preset])],data:entries,
    search:'',setSearch:()=>{},onExpand:async()=>{},pathname:'/',path:'/',
    sortPresets:[preset],grouping,initialState,...options,
  }));
}
function tableFor(data = entries, pageSize = 25, presets = [preset]) {
  let state:any = {...initialState,pagination:{pageIndex:0,pageSize},columnFilters:[],globalFilter:''};
  const table = createTable({
    data,columns:[...visibleColumns,...presetColumns(presets)],state,
    onStateChange:updater=>{state=typeof updater==='function'?updater(state):updater;table.setOptions(previous=>({...previous,state}));},
    renderFallbackValue:null,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getFilteredRowModel:getFilteredRowModel(),getPaginationRowModel:getPaginationRowModel(),
  });
  return {table,sections:()=>collectionSections(table.getRowModel().rows,grouping,(row,path)=>safeAccess(row.original.fields,path))};
}

test('normalized nested components provide localized group labels without repeated configuration',()=>{
  assert.deepEqual(grouping,{field:'meta.section',options:[{value:'press',label:'Presse'},{value:'tv',label:'TV'},{value:'radio',label:'radio'}]});
  assert.equal(resolveCollectionGrouping(undefined,undefined),undefined);
  const {sections} = tableFor();
  assert.deepEqual(sections().map(section=>[section.label,section.rows.map(row=>row.original.fields.title)]),[
    ['Presse',['Manufaktur feiert Betriebsjubiläum','Besuchergruppe aus der Region','Rinderfond im Produkttest']],
    ['TV',['Erbseneintopf im Fernsehbeitrag','Hühnersuppe im Fernsehbeitrag']],
  ]);
});

test('grouping follows filtered and paginated TanStack rows without synthetic entries',()=>{
  const {table,sections} = tableFor();
  table.setGlobalFilter('eintopf');
  assert.deepEqual(sections().map(section=>[section.label,section.rows.map(row=>row.original.fields.title)]),[['TV',['Erbseneintopf im Fernsehbeitrag']]]);
  table.setGlobalFilter('no matching entry');
  assert.deepEqual(sections(),[]);
  const pageEntries = Array.from({length:24},(_,index)=>entry(`press-${index.toString().padStart(2,'0')}`,'press',`2025-06-${(index+1).toString().padStart(2,'0')}`));
  pageEntries.push(entry('TV older','tv','2025-07-01'),entry('TV newest','tv','2025-07-02'));
  const paged = tableFor(pageEntries);
  assert.equal(paged.table.getPageCount(),2);
  assert.deepEqual(paged.sections().map(section=>[section.label,section.rows.length]),[['Presse',24],['TV',1]]);
  paged.table.setPageIndex(1);
  assert.deepEqual(paged.sections().map(section=>[section.label,section.rows.map(row=>row.original.fields.title)]),[['TV',['TV older']]]);
  assert.equal(paged.table.getRowModel().rows.length,1);
});

test('unknown and missing values retain every row and missing groups stay last',()=>{
  const rows = [entry('Missing',undefined,''),entry('Unknown','other',''),entry('Empty','',''),entry('Null',null,''),entry('Known','press',''),entry('Other second','other',''),entry('Zero',0,''),entry('False',false,'')];
  const before = JSON.stringify(rows);
  const sections = collectionSections(rows,grouping,(row,path)=>safeAccess(row.fields,path));
  assert.deepEqual(sections.map(section=>[section.label,section.rows.map(row=>row.name)]),[
    ['other',['Unknown','Other second']],['Presse',['Known']],['0',['Zero']],['false',['False']],['(empty)',['Missing','Empty','Null']],
  ]);
  assert.equal(sections.flatMap(section=>section.rows).length,rows.length);
  assert.equal(new Set(sections.flatMap(section=>section.rows)).size,rows.length);
  assert.equal(JSON.stringify(rows),before);
});

test('actual grouped table keeps preset order, native row groups and no sole selector or sort affordances',()=>{
  const html = render();
  assert.equal((html.match(/<tbody/g)??[]).length,2);
  assert.equal((html.match(/scope="rowgroup"/g)??[]).length,2);
  assert.match(html,/>Presse<\/th>/);
  assert.match(html,/>TV<\/th>/);
  assert.equal((html.match(/<td/g)??[]).length,10);
  assert.doesNotMatch(html,/<select|Sortierung|title="Sort |cursor-pointer/);
  const titles = ['Manufaktur feiert Betriebsjubiläum','Besuchergruppe aus der Region','Rinderfond im Produkttest','Erbseneintopf im Fernsehbeitrag','Hühnersuppe im Fernsehbeitrag'];
  assert.deepEqual([...titles].sort((a,b)=>html.indexOf(a)-html.indexOf(b)),titles);
  const filtered = render({search:'eintopf'});
  assert.match(filtered,/>TV<\/th>/);
  assert.doesNotMatch(filtered,/>Presse<\/th>/);
  const empty = render({search:'no matching entry'});
  assert.match(empty,/>No entries</);
  assert.doesNotMatch(empty,/scope="rowgroup"/);
});

test('ungrouped single and multiple preset controls and column sorting stay available',()=>{
  const ungrouped = render({grouping:undefined});
  assert.match(ungrouped,/<select/);
  assert.match(ungrouped,/Sortierung/);
  assert.match(ungrouped,/title="Sort ascending"/);
  assert.equal((ungrouped.match(/<tbody/g)??[]).length,1);
  assert.doesNotMatch(ungrouped,/scope="rowgroup"/);
  const oldest:SortPreset = {...preset,name:'oldest',label:'Oldest',fields:[preset.fields[0],{field:'publishedDate',order:'asc'}]};
  const multiple = render({columns:[...visibleColumns,...presetColumns([preset,oldest])],sortPresets:[preset,oldest],initialState:{...initialState,columnVisibility:{...initialState.columnVisibility,[presetColumnId("oldest")]:false}}});
  assert.match(multiple,/<select/);
  assert.match(multiple,/>Oldest<\/option>/);
  const compatible = tableFor(entries,25,[preset,oldest]);
  compatible.table.setSorting([{id:presetColumnId('oldest'),desc:false}]);
  assert.deepEqual(compatible.sections().map(section=>[section.label,section.rows.map(row=>row.original.fields.title)]),[
    ['Presse',['Rinderfond im Produkttest','Besuchergruppe aus der Region','Manufaktur feiert Betriebsjubiläum']],['TV',['Hühnersuppe im Fernsehbeitrag','Erbseneintopf im Fernsehbeitrag']],
  ]);
  const {table} = tableFor();
  table.setSorting([{id:'title',desc:false}]);
  assert.equal(table.getRowModel().rows[0].original.fields.title,'Besuchergruppe aus der Region');
  table.setSorting([{id:presetColumnId('website'),desc:false}]);
  assert.equal(table.getRowModel().rows[0].original.fields.title,'Manufaktur feiert Betriebsjubiläum');
});
