import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as limits from '../lib/upload-limits.ts';
import * as metadata from '../lib/media-metadata.ts';
const require=createRequire(import.meta.url);
function load(file: string, mocks: Record<string, any>) {
 const loadedModule={exports:{} as any};const compiled=ts.transpileModule(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',compiled)((id: string)=>id in mocks ? mocks[id] : require(id),loadedModule,loadedModule.exports);return loadedModule.exports;
}
function routeFixture({signedIn=true,allowed=true,extensions=[] as string[],mutation=async(..._args:any[])=>({ai:{classification:'generated'}})}={}) {
 let writes=0;
 const errors=load('lib/api-error.ts',{});
 // Exercise production session and token authorization; only backing auth/DB/GitHub I/O is injected.
 const session=load('lib/session-server.ts',{'next/headers':{headers:async()=>new Headers()},'@/lib/auth':{auth:{api:{getSession:async()=>signedIn ? {user:{id:'test',email:'test@example.invalid'}} : null}}}});
 const token=load('lib/token.ts',{'@octokit/app':{App: class {}},'@/lib/github-account':{getGithubAccount:async()=>({accessToken:'test'})},'@/lib/utils/octokit':{createOctokitInstance:()=>({rest:{repos:{get:async()=>{if(!allowed) throw new Error('denied');return {};}}}})},'@/db':{db:{query:{collaboratorTable:{findFirst:async()=>null}}}},'@/db/schema':{},'@/lib/crypto':{},'@/lib/collaborator-access':{collaboratorMatchesUserForRepo:()=>true},'@/lib/api-error':errors});
 const route=load('app/api/[owner]/[repo]/[branch]/media/[name]/[path]/ai/route.ts',{
  '@/lib/session-server':session,'@/lib/token':token,'@/lib/config-store':{getConfig:async()=>({object:{mediaMetadata:'data/media.json',media:[{name:'images',input:'media',extensions}]}})},'@/lib/api-error':errors,'@/lib/upload-limits':limits,'@/lib/media-metadata':metadata,'@/lib/utils/file':load('lib/utils/file.ts',{}),
  '@/lib/github-media-metadata':{mutateMediaMetadata:async(...args:any[])=>{writes++;return mutation(...args);}},'@/lib/commit-message':{resolveCommitIdentity:()=> 'app'},
 });
 const context=(path='media/image.jpg')=>({params:Promise.resolve({owner:'fixture',repo:'private',branch:'main',name:'images',path})});
 const request=(body:any={sha:'a'.repeat(40),revision:'b'.repeat(64),classification:'generated'},origin='https://cms.test')=>new Request('https://cms.test/api/fixture/private/main/media/images/media%2Fimage.jpg/ai',{method:'POST',headers:{host:'cms.test',origin},body:typeof body==='string'?body:JSON.stringify(body)});
 return {post:route.POST,context,request,get writes(){return writes;}};
}
test('actual AI route rejects absent session and denied private repository before mutation', async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{allowed:false},403]] as const){const f=routeFixture(options);assert.equal((await f.post(f.request(),f.context())).status,status);assert.equal(f.writes,0);}
});

test('cached library listing can reclassify externally replaced bytes using the fresh tree SHA', async () => {
 const oldSha='a'.repeat(40),currentSha='b'.repeat(40),manifestSha='c'.repeat(40);
 const path='media/image.jpg',bytes='externally replaced image';
 const document={version:1,assets:{[path]:{classification:'generated',sourceSha256:metadata.fingerprint('old image'),sourceGitSha:oldSha}}};
 let written:any,commits=0;
 const octokit={rest:{repos:{getContent:async()=>({data:{type:'file',sha:manifestSha,content:Buffer.from(JSON.stringify(document)).toString('base64')}})},git:{
  getRef:async()=>({data:{object:{sha:'head'}}}),getCommit:async()=>({data:{tree:{sha:'base'}}}),
  getTree:async()=>({data:{truncated:false,tree:[{path,type:'blob',mode:'100644',sha:currentSha},{path:'data/media.json',type:'blob',mode:'100644',sha:manifestSha}]}}),
  getBlob:async({file_sha}:any)=>({data:{content:Buffer.from(file_sha===manifestSha ? JSON.stringify(document) : bytes).toString('base64')}}),
  createBlob:async({content}:any)=>{written=JSON.parse(content);return {data:{sha:'d'.repeat(40)}};},
  createTree:async()=>({data:{sha:'new-tree'}}),createCommit:async()=>({data:{sha:'new-head'}}),
  updateRef:async({force}:any)=>{assert.equal(force,false);commits++;},
 }}};
 const helper=load('lib/github-media-metadata.ts',{
  '@/lib/utils/octokit':{createOctokitInstance:()=>octokit},'@/lib/media-metadata':metadata,'@/lib/api-error':load('lib/api-error.ts',{}),
  '@/lib/github-cache-file':{setBranchHeadSha:async()=>{}},'@/lib/commit-message':{buildCommitTokens:(v:any)=>v,resolveCommitMessage:()=> 'Classify image'},
 });
 const listing=load('app/api/[owner]/[repo]/[branch]/media/[name]/[path]/route.ts',{
  '@/lib/github-media-metadata':helper,'@/lib/media-metadata':metadata,'@/lib/api-error':load('lib/api-error.ts',{}),
  '@/lib/api-repo-context':{getRepoReadContext:async()=>({token:'test',config:{object:{mediaMetadata:'data/media.json',media:[{name:'images',input:'media'}]}}})},
  '@/lib/utils/file':{normalizePath:(v:string)=>v,getFileExtension:()=> 'jpg'},
  '@/lib/github-cache-file':{getMediaCache:async()=>[{type:'file',name:'image.jpg',path,sha:oldSha}]},
 });
 const response=await listing.GET(new Request('https://cms.test/library'),{params:Promise.resolve({owner:'fixture',repo:'private',branch:'main',name:'images',path:'media'})});
 assert.equal(response.status,200);
 const {data:[item]}=await response.json();assert.equal(item.ai.stale,true);assert.equal(item.sha,currentSha);
 const writer=routeFixture({mutation:helper.mutateMediaMetadata});
 const saved=await writer.post(writer.request({sha:item.sha,revision:item.ai.revision,classification:'modified'}),writer.context());
 assert.equal(saved.status,200);assert.equal(commits,1);
 assert.equal(written.assets[path].sourceGitSha,currentSha);assert.equal(written.assets[path].sourceSha256,metadata.fingerprint(bytes));assert.equal(written.assets[path].classification,'modified');
 const stale=await writer.post(writer.request({sha:oldSha,revision:item.ai.revision,classification:'modified'}),writer.context());
 assert.equal(stale.status,409);assert.equal(commits,1);
});
test('actual AI route rejects origin, malformed JSON, sibling/traversal and absent revisions',async()=>{
 const f=routeFixture();
 for(const [req,context,status] of [[f.request({},'https://evil.test'),f.context(),403],[f.request('{'),f.context(),400],[f.request(),f.context('media-other/a.jpg'),400],[f.request(),f.context('media/../a.jpg'),400],[f.request({classification:'generated'}),f.context(),400]] as const){assert.equal((await f.post(req,context)).status,status);}
 assert.equal(f.writes,0);
});
test('actual AI route rejects missing/invalid classifications and manual variants before writes', async()=>{
 for(const selection of [{}, {classification:'invalid'}, {derivedFrom:'media/source.jpg'}, {classification:'generated',derivedFrom:'media/source.jpg'}, {classification:'generated',derivedFrom:null}]) {
  const f=routeFixture();assert.equal((await f.post(f.request({sha:'a'.repeat(40),revision:'b'.repeat(64),...selection}),f.context())).status,400);assert.equal(f.writes,0);
 }
});
test('actual AI route enforces the selected media source extension restrictions before writes', async()=>{
 for(const path of ['media/image.png','media/image.webp','media/image.JPG']) {
  const f=routeFixture({extensions:['jpg']});assert.equal((await f.post(f.request(),f.context(path))).status,400);assert.equal(f.writes,0);
 }
 const allowed=routeFixture({extensions:['jpg']});assert.equal((await allowed.post(allowed.request(),allowed.context())).status,200);assert.equal(allowed.writes,1);
});
test('actual AI route authorizes private repository and saves a valid request',async()=>{const f=routeFixture();assert.equal((await f.post(f.request(),f.context())).status,200);assert.equal(f.writes,1);});

test('actual library route reports unverifiable and stale classifications without trusting cached file SHAs', async () => {
 const assets:any={
  'media/unverifiable.jpg':{classification:'generated',sourceSha256:'a'.repeat(64)},
  'media/verified.jpg':{classification:'modified',sourceSha256:'b'.repeat(64),sourceGitSha:'c'.repeat(40)},
  'media/cached.jpg':{classification:'generated',sourceSha256:'d'.repeat(64),sourceGitSha:'e'.repeat(40)},
 };
 const route=load('app/api/[owner]/[repo]/[branch]/media/[name]/[path]/route.ts',{
  '@/lib/github-media-metadata':{readMediaMetadataStatus:async()=>({metadata:{version:1,assets},stale:new Map([['media/unverifiable.jpg',true],['media/verified.jpg',false],['media/cached.jpg',false]]),sources:new Map([['media/unverifiable.jpg','c'.repeat(40)],['media/verified.jpg','c'.repeat(40)],['media/cached.jpg','e'.repeat(40)],['media/ordinary.jpg','f'.repeat(40)]])})},
  '@/lib/media-metadata':metadata,'@/lib/api-repo-context':{getRepoReadContext:async()=>({token:'test',config:{object:{mediaMetadata:'data/media.json',media:[{name:'images',input:'media'}]}}})},
  '@/lib/utils/file':{normalizePath:(value:string)=>value,getFileExtension:()=> 'jpg'},
  '@/lib/github-cache-file':{getMediaCache:async()=>['unverifiable','verified','cached','ordinary'].map(name=>({type:'file',name:`${name}.jpg`,path:`media/${name}.jpg`,sha:'c'.repeat(40)}))},
  '@/lib/api-error':load('lib/api-error.ts',{}),
 });
 const response=await route.GET(new Request('https://cms.test/library'),{params:Promise.resolve({owner:'fixture',repo:'private',branch:'main',name:'images',path:'media'})});assert.equal(response.status,200);
 const {data}=await response.json();const ai=(name:string)=>data.find((item:any)=>item.name===`${name}.jpg`).ai;
 assert.equal(ai('unverifiable').stale,true);assert.equal(ai('verified').stale,false);assert.equal(ai('cached').stale,false);assert.equal(ai('ordinary').stale,false);assert.equal(ai('ordinary').classification,'unmarked');
 assert.equal(data.find((item:any)=>item.name==='cached.jpg').sha,'e'.repeat(40));
 assert.equal(data.find((item:any)=>item.name==='ordinary.jpg').sha,'f'.repeat(40));
});
