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
new Function('require','module','exports',code)((name:string)=>name==='@/fields/registry'?{fieldTypes:new Set(['string','number','object','uuid','select','boolean','date'])}:name==='./collection-sort'?sort:require(name),loadedModule,loadedModule.exports);
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
