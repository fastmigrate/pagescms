import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Exercise the actual route, schema helpers, JSON parser and image read transform.
// Only authentication/GitHub I/O and unused React field components are replaced.
const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
function fixture(raw: any) {
  let config: any;
  let entries: any[] = [];
  let denied = false;
  let reads = 0;
  const registry: any = { readFns: {}, schemas: {}, defaultValues: {}, fieldTypes: new Set(["string","number","object","uuid","select","boolean","date"]) };
  const cache = new Map<string, any>();
  const mocks: Record<string, any> = {
    "@/fields/registry": registry,
    "@/lib/api-repo-context": { getRepoReadContext: async () => {
      if (denied) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { token: "fixture-token", config };
    } },
    "@/lib/github-cache-file": { getCollectionCache: async (...args: any[]) => {
      assert.equal(args[4], "fixture-token"); reads++; return entries;
    } },
  };
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path).exports;
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const require = (specifier: string): any => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier === "./view-component" || specifier === "./edit-component") return {};
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return nativeRequire(specifier);
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => existsSync(file));
      if (!resolved) throw new Error(`Unresolved fixture dependency: ${specifier}`);
      return load(resolved);
    };
    new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  registry.readFns.date = load(resolve(root, "fields/core/date/index.ts")).read;
  const { normalizeConfig } = load(resolve(root, "lib/config.ts"));
  const { ConfigSchema } = load(resolve(root, "lib/config-schema.ts"));
  const validation = ConfigSchema.safeParse(raw);
  assert.equal(validation.success, true, JSON.stringify(validation.error?.issues));
  config = { object: normalizeConfig(raw) };
  const schema = config.object.content[0];
  const { GET } = load(resolve(root, "app/api/[owner]/[repo]/[branch]/collections/[name]/route.ts"));
  return {
    columns: (presets: any[]) => presetColumns(presets, false, (value, path) => {
      const {getFieldByPath} = load(resolve(root, "lib/schema.ts"));
      const field = getFieldByPath(schema.fields, path);
      const transformed = registry.readFns[field.type]?.(value,field,config.object);
      return transformed === undefined ? value : transformed;
    }),
    schema, config, deny: () => { denied = true; }, reads: () => reads,
    setEntries: (values: any[]) => { entries = values.map((value, index) => ({ type: "file", path: `content/works/${index}.json`, name: `${index}.json`, content: JSON.stringify(value) })); },
    request: (params: Record<string, string> = {}, name = "works") => GET(
      { nextUrl: new URL(`https://cms.invalid/api?${new URLSearchParams({ path: "content/works", ...params })}`) },
      { params: Promise.resolve({ owner: "fixture", repo: "art", branch: "main", name }) },
    ),
  };
}


import { comparePresetEntries, presetRequestFields, presetColumns } from '../lib/collection-sort.ts';

test('normalization and collection loading resolve reverse-declared deep component chains', async () => {
  const preset: any = {name:'rank',label:'Rank',fields:[{field:'meta.rank',order:'asc'}]};
  const f = fixture({components:{A:{component:'B'},B:{component:'C'},C:{type:'object',fields:[{name:'rank',type:'number'}]}},content:[{name:'works',type:'collection',path:'content/works',format:'json',filename:'{primary}.json',fields:[{name:'meta',component:'A'}],view:{sortPresets:[preset]}}]});
  assert.equal(f.schema.fields[0].type,'object');
  f.setEntries([{meta:{rank:20}},{meta:{rank:2}}]);
  const result = await (await f.request({fields:['path',...presetRequestFields([preset])].join(',')})).json();
  assert.deepEqual(result.data.contents.map((entry:any)=>entry.fields.meta.rank),[20,2]);
  assert.deepEqual(result.data.contents.sort((a:any,b:any)=>comparePresetEntries(a,b,preset)).map((entry:any)=>entry.fields.meta.rank),[2,20]);
});

test('reserved content paths survive request prefixes and sort by their values', async () => {
  for(const field of ['path','fields.rank']) {
    const preset: any = {name:'rank',label:'Rank',fields:[{field,order:'asc'}]};
    const f = fixture({content:[{name:'works',type:'collection',path:'content/works',format:'json',filename:'{primary}.json',fields:[{name:'path',type:'number'},{name:'fields',type:'object',fields:[{name:'rank',type:'number'}]}],view:{sortPresets:[preset]}}]});
    f.setEntries([{path:20,fields:{rank:20}},{path:2,fields:{rank:2}}]);
    const result = await (await f.request({fields:['path',...presetRequestFields([preset])].join(',')})).json();
    assert.equal(result.data.contents.length,2);
    const sorted = result.data.contents.sort((a:any,b:any)=>comparePresetEntries(a,b,preset));
    assert.equal(sorted[0].path,'content/works/1.json');
    assert.equal(sorted[0].fields[field === 'path' ? 'path' : 'fields'] instanceof Object, field !== 'path');
  }
});


test('explicit date order uses the same read transform as collection values', async () => {
  for (const options of [{format:'dd/MM/yyyy'}, {format:'dd/MM/yyyy HH:mm',time:true}]) {
    const suffix = options.time ? ' 15:30' : '';
    const dates = ['02/01/2026'+suffix,'01/01/2026'+suffix];
    const preset: any = {name:'dates',label:'Dates',fields:[{field:'date',order:'asc',values:dates}]};
    const f = fixture({content:[{name:'works',type:'collection',path:'content/works',format:'json',filename:'{primary}.json',fields:[{name:'date',type:'date',options}],view:{sortPresets:[preset]}}]});
    f.setEntries([{date:dates[1]},{date:dates[0]}]);
    const result = await (await f.request({fields:['path',...presetRequestFields([preset])].join(',')})).json();
    const [column] = f.columns([preset]);
    const ordered = result.data.contents.sort((a:any,b:any)=>column.sortingFn({original:a},{original:b}));
    assert.equal(ordered[0].path,'content/works/1.json');
    assert.match(ordered[0].fields.date,/^2026-01-02/);
    assert.deepEqual(preset.fields[0].values,dates,'stored configuration is not mutated');
  }
});
