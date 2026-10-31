import * as reorder from "../lib/collection-order.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as sort from '../lib/collection-sort.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../lib/config-schema.ts',import.meta.url),'utf8');
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const loadedModule = {exports:{} as any};
new Function('require','module','exports',code)((name:string)=>name==='@/fields/registry'?{fieldTypes:new Set(['string','number','object','uuid','select','boolean','date'])}:name==='./collection-order'?reorder:name==='./collection-sort'?sort:require(name),loadedModule,loadedModule.exports);
const {ConfigSchema} = loadedModule.exports;
const preset = {name:'website',label:'Website order',fields:[{field:'year',order:'desc'},{field:'id',order:'asc'}]};
const entry = {name:'entries',type:'collection',path:'content',fields:[{name:'year',type:'number'},{name:'id',type:'uuid',hidden:true}],view:{fields:['year'],sortPresets:[preset],default:{sortPreset:'website'}}};
const config = (value:any)=>({content:[value]});

test('actual configuration schema accepts opt-in presets and unchanged legacy views',()=>{
  assert.equal(ConfigSchema.safeParse(config(entry)).success,true);
  assert.equal(ConfigSchema.safeParse(config({...entry,view:{fields:['year'],sort:['year'],default:{sort:'year',order:'desc'}}})).success,true);
});
test('rejects unknown presets, conflicting defaults, duplicate names and nonexistent/non-scalar paths',()=>{
  for(const patch of [
    {default:{sortPreset:'absent'}}, {default:{sortPreset:'website',sort:'year'}},
    {sortPresets:[preset,preset]},
    {sortPresets:[{...preset,fields:[{field:'absent',order:'asc'}]}]},
  ]) assert.equal(ConfigSchema.safeParse(config({...entry,view:{...entry.view,...patch}})).success,false);
  assert.equal(ConfigSchema.safeParse(config({...entry,fields:[{name:'year',type:'object',fields:[{name:'value',type:'number'}]},{name:'id',type:'uuid'}]})).success,false);
  assert.equal(ConfigSchema.safeParse(config({...entry,type:'file'})).success,false);
});
test('validates paths in nested groups and primitive field components',()=>{
  const grouped = {components:{year:{type:'number'}},content:[{name:'pages',type:'group',items:[{...entry,fields:[{name:'year',component:'year'},{name:'id',type:'uuid'}]}]}]};
  assert.equal(ConfigSchema.safeParse(grouped).success,true);
  grouped.content[0].items[0].view = {...grouped.content[0].items[0].view, default:{sortPreset:'missing'}};
  assert.equal(ConfigSchema.safeParse(grouped).success,false);
});

test('rejects multi-select fields including inherited options', () => {
  const selection = {...entry, fields:[{name:'year',type:'select',options:{multiple:true,values:['10','2']}},{name:'id',type:'uuid'}]};
  assert.equal(ConfigSchema.safeParse(config(selection)).success,false);
  const inherited = {components:{multi:{type:'select',options:{multiple:true,values:['10','2']}}},content:[{...entry,fields:[{name:'year',component:'multi',options:{placeholder:'Choose'}},{name:'id',type:'uuid'}]}]};
  assert.equal(ConfigSchema.safeParse(inherited).success,false);
  inherited.content[0].fields[0].options = {multiple:false} as any;
  assert.equal(ConfigSchema.safeParse(inherited).success,true);
});

test('resolves chained components and nested fields without depending on map order', () => {
  const components = {rank:{component:'base'}, base:{type:'number'}};
  const value = {components,content:[{...entry,fields:[{name:'year',component:'rank'},{name:'id',type:'uuid'}]}]};
  assert.equal(ConfigSchema.safeParse(value).success,true);
  const nested = {components:{outer:{component:'objectBase'},objectBase:{type:'object',fields:[{name:'rank',component:'rank'}]},...components},content:[{...entry,fields:[{name:'meta',component:'outer'},{name:'id',type:'uuid'}],view:{...entry.view,sortPresets:[{...preset,fields:[{field:'meta.rank',order:'asc'}]}]}}]};
  assert.equal(ConfigSchema.safeParse(nested).success,true);
  for (const invalid of [{rank:{component:'missing'}},{rank:{component:'rank'}},{rank:{component:'base'},base:{component:'rank'}}]) {
    assert.equal(ConfigSchema.safeParse({...value,components:invalid}).success,false);
  }
});

test('ordered values must match stored scalar types, including select strings', () => {
  const cases = [
    ['number',[10,2],['10','2']], ['boolean',[true,false],['true','false']],
    ['string',['10','2'],[10,2]], ['select',['10','2'],[10,2]],
    ['uuid',['a','b'],[1,2]], ['date',['2026-01-01','2025-01-01'],[2026,2025]],
  ] as const;
  for (const [type,valid,invalid] of cases) {
    const make = (values:any) => ({components:{scalar:{type}},content:[{...entry,fields:[{name:'year',component:'scalar'},{name:'id',type:'uuid'}],view:{...entry.view,sortPresets:[{...preset,fields:[{field:'year',order:'asc',values}]}]}}]});
    const result = ConfigSchema.safeParse(make(valid));
    assert.equal(result.success,true,JSON.stringify(result.error?.issues));
    assert.equal(ConfigSchema.safeParse(make(invalid)).success,false,type);
  }
});


test('rejects nested preset paths through non-object fields', () => {
  const value = {...entry,fields:[{name:'title',type:'string',fields:[{name:'rank',type:'number'}]}],view:{...entry.view,sortPresets:[{...preset,fields:[{field:'title.rank',order:'asc'}]}]}};
  assert.equal(ConfigSchema.safeParse(config(value)).success,false);
  value.fields[0].type = 'object';
  assert.equal(ConfigSchema.safeParse(config(value)).success,true);
});

test('grouped flat collections accept a select field and a leading named default preset', () => {
  const grouped = {
    ...entry,
    subfolders: false,
    fields: [
      {name:'section',type:'select',options:{values:[{value:'press',label:'Presse'},{value:'tv',label:'TV'}]}},
      {name:'publishedDate',type:'date'},
    ],
    view: {
      fields: ['publishedDate'], groupBy: 'section',
      sortPresets: [{name:'website',label:'Website',fields:[{field:'section',order:'asc',values:['press','tv']},{field:'publishedDate',order:'desc'}]}],
      default: {sortPreset:'website'},
    },
  };
  const result = ConfigSchema.safeParse(config(grouped));
  assert.equal(result.success,true,JSON.stringify(result.error?.issues));
});

const groupedEntry = () => ({
  ...entry,
  subfolders: false,
  fields: [
    {name:'section',type:'select',options:{values:[{name:'press',label:'Presse'},{name:'tv',label:'TV'}]}},
    {name:'publishedDate',type:'date'},
  ],
  view: {
    groupBy:'section',
    sortPresets:[{name:'website',label:'Website',fields:[{field:'section',order:'asc',values:['press','tv']},{field:'publishedDate',order:'desc'}]}],
    default:{sortPreset:'website'},
  },
});

test('grouping rejects unsupported collection shapes and sorting contracts', () => {
  for (const patch of [
    {type:'file'}, {subfolders:undefined}, {subfolders:true}, {list:true},
    {view:{layout:'tree'}}, {view:{node:'index.json'}},
    {view:{reorder:{field:'publishedDate',sortPreset:'website'}}},
    {view:{default:undefined}}, {view:{default:{sortPreset:'missing'}}},
    {view:{sortPresets:undefined}},
    {view:{sortPresets:[{name:'website',label:'Website',fields:[{field:'publishedDate',order:'desc'},{field:'section',order:'asc'}]}]}},
  ]) {
    const value = groupedEntry();
    const result = ConfigSchema.safeParse(config({...value,...patch,view:{...value.view,...patch.view}}));
    assert.equal(result.success,false,JSON.stringify(patch));
  }
  const value = groupedEntry();
  value.view.sortPresets.push({name:'oldest',label:'Oldest',fields:[{field:'section',order:'asc',values:['press','tv']},{field:'publishedDate',order:'asc'}]});
  assert.equal(ConfigSchema.safeParse(config(value)).success,true);
  value.view.sortPresets[1].fields.reverse();
  assert.equal(ConfigSchema.safeParse(config(value)).success,false);
});

test('grouping requires a scalar single-select and a safe existing field path', () => {
  for (const field of [
    {name:'section',type:'string'},
    {name:'section',type:'select',list:true},
    {name:'section',type:'select',options:{multiple:true}},
    {name:'section',type:'object',fields:[{name:'value',type:'select'}]},
  ]) {
    const value = groupedEntry();
    assert.equal(ConfigSchema.safeParse(config({...value,fields:[field,value.fields[1]]})).success,false,JSON.stringify(field));
  }
  for (const groupBy of ['', 'missing', '__proto__.section', 'section.constructor', 'section[0]']) {
    const value = groupedEntry();
    assert.equal(ConfigSchema.safeParse(config({...value,view:{...value.view,groupBy}})).success,false,groupBy);
  }
});

test('grouping reuses inherited component options and nested field resolution', () => {
  const value = groupedEntry();
  const raw = {
    components:{section:{component:'base'},base:{type:'select',options:value.fields[0].options},meta:{type:'object',fields:[{name:'section',component:'section',options:{placeholder:'Bereich'}}]}},
    content:[{...value,fields:[{name:'meta',component:'meta'},value.fields[1]],view:{...value.view,groupBy:'meta.section',sortPresets:[{...value.view.sortPresets[0],fields:[{field:'meta.section',order:'asc',values:['press','tv']},{field:'publishedDate',order:'desc'}]}]}}],
  };
  assert.equal(ConfigSchema.safeParse(raw).success,true);
  raw.components.base.options = {...raw.components.base.options,multiple:true} as any;
  assert.equal(ConfigSchema.safeParse(raw).success,false);
  raw.components.meta.fields[0].options = {multiple:false} as any;
  assert.equal(ConfigSchema.safeParse(raw).success,true);
  raw.components.section.component = 'missing';
  assert.equal(ConfigSchema.safeParse(raw).success,false);
  raw.components.section.component = 'section';
  assert.equal(ConfigSchema.safeParse(raw).success,false);
});


test('valid manual ordering remains available only without browse grouping', () => {
  const value:any = groupedEntry();
  value.format = 'json';
  value.fields.push({name:'order',type:'number'});
  value.view.reorder = {field:'order',sortPreset:'website'};
  value.view.sortPresets[0].fields.push({field:'order',order:'asc'});
  assert.equal(ConfigSchema.safeParse(config({...value,view:{...value.view,groupBy:undefined}})).success,true);
  assert.equal(ConfigSchema.safeParse(config(value)).success,false);
});
