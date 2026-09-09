import assert from 'node:assert/strict';
import test from 'node:test';
import { createTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, getFilteredRowModel } from '@tanstack/react-table';
import { SortPresetSchema, comparePresetEntries, presetColumns, presetColumnId, presetFieldPaths } from '../lib/collection-sort.ts';

const preset = SortPresetSchema.parse({ name: 'website', label: 'Website order', fields: [
  { field: 'category', order: 'asc', values: ['solo', 'group'] },
  { field: 'year', order: 'desc' }, { field: 'order', order: 'asc' }, { field: 'id', order: 'asc' },
] });
const entry = (id: string, category: string, year: number, order: number) => ({ path: `${id}.json`, type: 'file', fields: { title: id, id, category, year, order } });
const rows = [entry('g-new', 'group', 2030, 1), entry('s-old', 'solo', 2020, 1), entry('s-ten', 'solo', 2026, 10), entry('s-two-b', 'solo', 2026, 2), entry('s-two-a', 'solo', 2026, 2)];
const expected = ['s-two-a', 's-two-b', 's-ten', 's-old', 'g-new'];

test('matches category sections, descending years, numeric order and stable IDs regardless of input order', () => {
  const before = JSON.stringify(rows);
  for (const input of [rows, [...rows].reverse(), [...rows.slice(2), ...rows.slice(0, 2)]]) {
    assert.deepEqual([...input].sort((a,b) => comparePresetEntries(a,b,preset)).map(row => row.fields.id), expected);
  }
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(presetFieldPaths([preset]), ['category', 'year', 'order', 'id']);
});

test('unknown category and missing values follow defined values; ties fall back to path', () => {
  const items = [entry('unknown', 'other', 2050, 1), {path:'missing.json',type:'file',fields:{}}, ...rows];
  assert.deepEqual(items.sort((a,b) => comparePresetEntries(a,b,preset)).map(row => row.path), [...expected.map(id => `${id}.json`), 'unknown.json', 'missing.json']);
  const simple = SortPresetSchema.parse({name:'year',label:'Year',fields:[{field:'year',order:'desc'}]});
  assert.ok(comparePresetEntries({path:'a',fields:{year:0}}, {path:'b',fields:{year:null}},simple) < 0);
  assert.ok(comparePresetEntries({path:'a',fields:{year:2026}}, {path:'b',fields:{year:2026}},simple) < 0);
});

test('nested fields and folders retain deterministic ordering', () => {
  const nested = SortPresetSchema.parse({name:'nested',label:'Nested',fields:[{field:'meta.rank',order:'asc'}]});
  assert.ok(comparePresetEntries({path:'a',fields:{meta:{rank:2}}},{path:'b',fields:{meta:{rank:10}}},nested)<0);
  const dir = {path:'folder',type:'dir'};
  assert.ok(comparePresetEntries(dir,rows[0],preset,true)<0);
  assert.ok(comparePresetEntries(dir,rows[0],preset,false)>0);
});

test('real TanStack table sorts hidden preset before pagination, retains search and restores after column sort', () => {
  let state: any = {sorting:[{id:presetColumnId('website'),desc:false}],columnVisibility:{[presetColumnId('website')]:false},pagination:{pageIndex:0,pageSize:2},columnFilters:[],globalFilter:''};
  const table = createTable({data: rows, columns:[{id:'title',accessorFn:(r:any)=>r.fields.title}, ...presetColumns([preset])], state,
    onStateChange: updater => {state = typeof updater === 'function' ? updater(state) : updater; table.setOptions(prev=>({...prev,state}));},
    renderFallbackValue:null, getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel(),getFilteredRowModel:getFilteredRowModel(),
  });
  const ids = () => table.getRowModel().rows.map(row=>row.original.fields.id);
  assert.deepEqual(ids(), expected.slice(0,2));
  assert.deepEqual(table.getVisibleLeafColumns().map(c=>c.id),['title']);
  table.setPageIndex(1); assert.deepEqual(ids(),expected.slice(2,4));
  table.setSorting([{id:'title',desc:false}]); table.setPageIndex(0); assert.equal(ids()[0],'g-new');
  table.setSorting([{id:presetColumnId('website'),desc:false}]); assert.deepEqual(ids(),expected.slice(0,2));
  table.setGlobalFilter('s-two'); assert.deepEqual(ids(),expected.slice(0,2));
  // Editing/reloading a record recomputes order, without a persisted composite key.
  table.setGlobalFilter('');
  table.setOptions(prev=>({...prev,data:rows.map(row=>row.fields.id==='s-ten'?entry('s-ten','solo',2026,1):row)}));
  assert.equal(ids()[0],'s-ten');
});

test('preset schema rejects malformed definitions', () => {
  for (const fields of [[],[{field:'year',order:'sideways'}],[{field:'__proto__.year',order:'asc'}],[{field:'year',order:'asc'},{field:'year',order:'desc'}],[{field:'category',order:'asc',values:['solo','solo']}]]) {
    assert.equal(SortPresetSchema.safeParse({...preset,fields}).success,false);
  }
});
