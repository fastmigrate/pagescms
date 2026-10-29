import assert from 'node:assert/strict';
import test from 'node:test';
import { moveOrder, orderDraft, orderDirty, orderPayload, orderValues, reorderDefinition } from '../lib/collection-order.ts';
const schema = { type:'collection', subfolders:false, format:'json', filename:'{title}.json', fields:[{name:'title',type:'string'},{name:'category',type:'string'},{name:'year',type:'number'},{name:'order',type:'number',hidden:true},{name:'id',type:'uuid'}], view:{reorder:{field:'order',sortPreset:'website'},sortPresets:[{name:'website',label:'Website',fields:[{field:'category',order:'asc'},{field:'year',order:'desc'},{field:'order',order:'asc'},{field:'id',order:'asc'}]}]}};
test('explicit numeric field preserves prefix groups and suffix tie breakers',()=>{
 const definition=reorderDefinition(schema);
 assert.deepEqual(definition.groupFields,['category','year']);
 assert.equal(definition.preset.fields.at(-1)?.field,'id');
 assert.deepEqual(orderValues(definition,3),[1,2,3]);
 assert.deepEqual(orderValues(reorderDefinition({...schema,fields:schema.fields.map(f=>f.name==='order'?{...f,options:{min:0.5,max:1.5,step:0.5}}:f)}),3),[0.5,1,1.5]);
 assert.throws(()=>orderValues({...definition,max:2},3));
 assert.throws(()=>orderValues({...definition,start:1e20,step:1},2));
 assert.deepEqual(orderValues({...definition,start:1e15,step:1},2),[1e15,1e15+1]);
 assert.throws(()=>orderValues({...definition,start:1e15,step:0.1},2));
 assert.deepEqual(orderValues({...definition,start:0.1,min:0.1,max:0.3,step:0.1},3),[0.1,0.2,0.3]);
});
test('unsupported scopes, constraints, fields and filename identities fail before use',()=>{
 for(const patch of [{subfolders:true},{list:true},{format:'yaml'},{view:{...schema.view,layout:'tree'}},{filename:'{order}.json'},{filename:'{fields.order}.json'},{filename:'{slug}.json',view:{...schema.view,primary:'order'}}]) assert.throws(()=>reorderDefinition({...schema,...patch}));
 for(const field of [{type:'string'},{readonly:true},{list:true},{options:{step:0}},{options:{step:2}},{options:{min:2,max:1}}]) assert.throws(()=>reorderDefinition({...schema,fields:schema.fields.map(f=>f.name==='order'?{...f,...field}:f)}));
 assert.throws(()=>reorderDefinition({...schema,filename:'{primary}.json',fields:[schema.fields[3]]}));
 const nested={...schema,fields:[{name:'meta',type:'object',required:true,fields:[{name:'order',type:'number',hidden:true}]}],view:{reorder:{field:'meta.order',sortPreset:'nested'},sortPresets:[{name:'nested',label:'Nested',fields:[{field:'meta.order',order:'asc'}]}]}};
 assert.equal(reorderDefinition(nested).field,'meta.order');
 assert.throws(()=>reorderDefinition({...nested,fields:[{...nested.fields[0],required:false}]}));
});
test('draft moves are immutable, group scoped and dirty only from changed identity order',()=>{
 const baseline={head:'head',configSha:'config',field:'order',columns:[],groups:[{id:'a',label:'A',entries:[{path:'a.json',sha:'a',label:'A',value:1,fields:{}},{path:'b.json',sha:'b',label:'B',value:2,fields:{}}]},{id:'b',label:'B',entries:[]}]};
 const draft=orderDraft(baseline);
 assert.equal(orderDirty(draft),false);
 const moved={...draft,groups:draft.groups.map(group=>group.id==='a'?{...group,paths:moveOrder(group.paths,0,1)}:group)};
 assert.equal(orderDirty(moved),true);
 assert.deepEqual(draft.groups[0].paths,['a.json','b.json']);
 assert.deepEqual(moveOrder(draft.groups[0].paths,0,-1),draft.groups[0].paths);
 assert.deepEqual(orderPayload(moved),{expectedHead:'head',configSha:'config',groups:[{id:'a',baseline:[{path:'a.json',sha:'a'},{path:'b.json',sha:'b'}],paths:['b.json','a.json']},{id:'b',baseline:[],paths:[]}]});
 assert.equal(orderDirty(orderDraft(baseline)),false);
});
