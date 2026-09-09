import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as sort from '../lib/collection-sort.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../lib/config-schema.ts',import.meta.url),'utf8');
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loadedModule = {exports:{} as any};
new Function('require','module','exports',code)((name:string)=>name==='@/fields/registry'?{fieldTypes:new Set(['string','number','object','uuid','select','boolean'])}:name==='./collection-sort'?sort:require(name),loadedModule,loadedModule.exports);
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
  grouped.content[0].items[0].view.default.sortPreset = 'missing';
  assert.equal(ConfigSchema.safeParse(grouped).success,false);
});
