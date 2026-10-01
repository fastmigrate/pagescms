import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteRecord, effectiveClassification, fingerprint, parseMediaMetadata, recordRevision, renameRecords, assertRepositoryPath, withinMedia } from '../lib/media-metadata.ts';
const record = (classification?: 'generated' | 'modified' | 'unmarked', derivedFrom?: string) => ({sourceSha256: 'a'.repeat(64), classification, derivedFrom});
const document = () => ({version: 1 as const, assets: {'media/source.jpg': {...record('generated'), privateNote: null}, 'media/crop.webp': record(undefined, 'media/source.jpg'), 'media/small.png': record(undefined, 'media/crop.webp')}, future: {version: 2}});
test('derivatives inherit and explicit unmarked overrides without deleting unknown keys', () => {
  const doc = parseMediaMetadata(document());
  assert.equal(effectiveClassification(doc, 'media/small.png'), 'generated');
  doc.assets['media/small.png'].classification = 'unmarked';
  assert.equal(effectiveClassification(doc, 'media/small.png'), 'unmarked');
  assert.equal(doc.assets['media/source.jpg'].privateNote, null);
  assert.deepEqual(doc.future, {version: 2});
});
test('rename moves classification and direct derivation references', () => {
  const doc = document(); renameRecords(doc, 'media/source.jpg', 'media/new.jpg');
  assert.equal(doc.assets['media/crop.webp'].derivedFrom, 'media/new.jpg');
  assert.equal(effectiveClassification(parseMediaMetadata(doc), 'media/small.png'), 'generated');
});
test('delete materializes inherited labels before removing source links', () => {
  const doc = document(); deleteRecord(doc, 'media/source.jpg');
  assert.equal(doc.assets['media/crop.webp'].derivedFrom, undefined);
  assert.equal(doc.assets['media/crop.webp'].classification, 'generated');
  assert.equal(effectiveClassification(parseMediaMetadata(doc), 'media/small.png'), 'generated');
});
test('missing, cyclic, invalid and unsupported inputs are rejected', () => {
  for (const path of ['/media/a.jpg','../a.jpg','media/../a.jpg','media//a.jpg','media\\a.jpg','__proto__/a.jpg']) assert.throws(() => assertRepositoryPath(path));
  assert.equal(withinMedia('media-extra/a.jpg', 'media'), false);
  for (const doc of [
    {version: 2, assets: {}},
    {version: 1, assets: {'media/a.jpg': record(undefined, 'media/missing.jpg')}},
    {version: 1, assets: {'media/a.jpg': record('generated', 'media/a.jpg')}},
    {version: 1, assets: {'media/a.gif': record('generated')}},
    {version: 1, assets: {'media/a.jpg': {...record('generated'), sourceSha256: 'broken'}}},
  ]) assert.throws(() => parseMediaMetadata(doc));
});
test('record revisions distinguish source and classification changes', () => {
  assert.notEqual(recordRevision(record('generated')), recordRevision(record('modified')));
  assert.equal(fingerprint(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
