import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteRecord, effectiveClassification, fingerprint, parseMediaMetadata, recordRevision, renameRecords, assertRepositoryPath, withinMedia, type Classification } from '../lib/media-metadata.ts';
const record = (classification: Classification) => ({sourceSha256: 'a'.repeat(64), classification});
const document = () => ({version: 1 as const, assets: {'media/source.jpg': {...record('generated'), privateNote: null}, 'media/other.webp': record('modified'), 'media/small.png': record('unmarked')}, future: {version: 2}});
test('originals have independent classifications and preserve unknown keys', () => {
  const doc = parseMediaMetadata(document());
  assert.equal(effectiveClassification(doc, 'media/source.jpg'), 'generated');
  assert.equal(effectiveClassification(doc, 'media/other.webp'), 'modified');
  assert.equal(effectiveClassification(doc, 'media/small.png'), 'unmarked');
  assert.equal(effectiveClassification(doc, 'media/absent.jpg'), 'unmarked');
  assert.equal(doc.assets['media/source.jpg'].privateNote, null);
  assert.deepEqual(doc.future, {version: 2});
});
test('rename moves only the original record', () => {
  const doc = parseMediaMetadata(document()); const unrelated = structuredClone(doc.assets['media/other.webp']);
  renameRecords(doc, 'media/source.jpg', 'media/new.jpg');
  assert.equal(effectiveClassification(parseMediaMetadata(doc), 'media/new.jpg'), 'generated');
  assert.equal(doc.assets['media/source.jpg'], undefined);
  assert.deepEqual(doc.assets['media/other.webp'], unrelated);
});
test('delete removes only the original record', () => {
  const doc = parseMediaMetadata(document()); const unrelated = structuredClone(doc.assets['media/other.webp']);
  deleteRecord(doc, 'media/source.jpg');
  assert.equal(doc.assets['media/source.jpg'], undefined);
  assert.deepEqual(parseMediaMetadata(doc).assets['media/other.webp'], unrelated);
});
test('missing classifications, manual variants, unsafe paths and unsupported inputs are rejected', () => {
  for (const path of ['/media/a.jpg','../a.jpg','media/../a.jpg','media//a.jpg','media\\a.jpg','__proto__/a.jpg']) assert.throws(() => assertRepositoryPath(path));
  assert.equal(withinMedia('media-extra/a.jpg', 'media'), false);
  for (const doc of [
    {version: 2, assets: {}},
    {version: 1, assets: {'media/a.jpg': {sourceSha256: 'a'.repeat(64)}}},
    {version: 1, assets: {'media/a.jpg': {...record('generated'), derivedFrom: 'media/other.jpg'}}},
    {version: 1, assets: {'media/a.jpg': {...record('generated'), derivedFrom: undefined}}},
    {version: 1, assets: {'media/a.jpg': {...record('generated'), classification: 'invalid'}}},
    {version: 1, assets: {'media/a.gif': record('generated')}},
    {version: 1, assets: {'media/a.jpg': {...record('generated'), sourceSha256: 'broken'}}},
  ]) assert.throws(() => parseMediaMetadata(doc));
});
test('record revisions distinguish source and classification changes', () => {
  assert.notEqual(recordRevision(record('generated')), recordRevision(record('modified')));
  assert.equal(fingerprint(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
