import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as sort from '../lib/collection-sort.ts';
import * as reorder from '../lib/collection-order.ts';
const require = createRequire(import.meta.url);
const loaded = { exports:{} as any };
const source = readFileSync(new URL('../lib/config-schema.ts',import.meta.url),'utf8');
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)((name:string)=>name==='@/fields/registry'?{fieldTypes:new Set(['string','number','object','uuid','select','boolean','date'])}:name==='./collection-sort'?sort:name==='./collection-order'?reorder:require(name),loaded,loaded.exports);
const { ConfigSchema } = loaded.exports;
const item={name:'jobs',type:'collection',path:'jobs',filename:'{title}.json',subfolders:false,fields:[{name:'title',type:'string'},{name:'order',type:'number',hidden:true}],view:{reorder:{field:'order',sortPreset:'website'},sortPresets:[{name:'website',label:'Website',fields:[{field:'order',order:'asc'}]}]}};
const config=(entry:any,components?:any)=>({content:[entry],...(components?{components}:{})});
test('actual config schema enables raw inferred JSON and chained optional hidden numeric component',()=>{
 assert.equal(ConfigSchema.safeParse(config(item)).success,true);
 const result=ConfigSchema.safeParse(config({...item,fields:[item.fields[0],{name:'order',component:'rank',hidden:true}]},{rank:{component:'base'},base:{type:'number',options:{min:0,step:2,max:100}}}));
 assert.equal(result.success,true,JSON.stringify(result.error?.issues));
});
test('actual schema rejects unsupported reorder configuration rather than exposing a broken action',()=>{
 const variants=[
 {...item,subfolders:undefined}, {...item,format:'yaml'}, {...item,filename:'{order}.json'},
 {...item,view:{...item.view,reorder:{field:'missing',sortPreset:'website'}}},
 {...item,view:{...item.view,reorder:{field:'order',sortPreset:'missing'}}},
 {...item,view:{...item.view,sortPresets:[{...item.view.sortPresets[0],fields:[{field:'order',order:'desc'}]}]}},
 {...item,fields:[item.fields[0],{name:'order',type:'number',readonly:true}]},
 {...item,fields:[item.fields[0],{name:'order',component:'missing'}]},
 {...item,fields:[item.fields[0],{name:'order',component:'cycle'}]},
 ];
 for(const value of variants) assert.equal(ConfigSchema.safeParse(config(value,{cycle:{component:'cycle'}})).success,false,JSON.stringify(value));
});
