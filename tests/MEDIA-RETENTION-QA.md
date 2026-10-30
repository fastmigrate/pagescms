# Verify media reference protection locally

Run the collector and actual-route regressions.

```sh
node --test tests/media-references.test.mts tests/media-reference-route.test.mts tests/github-media-metadata.test.mts tests/media-operations.test.mts
```

The route fixture runs production session and repository authorization, origin
checks, configuration parsing, normalization, field transforms, serialization,
and the immutable publisher. It injects only external auth, persistence and GitHub
I/O. Its branch model rejects a non-fast-forward update. It never contacts GitHub.

Verify these outcomes.

1. Delete and Rename of a referenced file return a refusal with visible content
   and field labels, a collection title when available, and replacement steps.
   Messages omit internal paths and field keys. Missing-file and verification
   failures give appropriate selection, retry or administrator guidance.
   No Git objects are created on refusal.
2. Unused files can be deleted and renamed. A saved replacement permits cleanup
   of the old file. An unsaved browser change does not permit that cleanup.
3. Missing or stale content Save preserves the previous document. Merge and
   duplicate use bytes from the same snapshot and check their final saved values.
4. Both Save-before-Delete and Delete-before-Save interleavings publish one
   candidate. Retrying the loser reads the new branch and refuses the unsafe edit.
5. A concurrent configuration change rejects the old plan. Saved drafts, nested
   fields, root lists, groups, components and block variants all contribute uses.
6. Content and media aliases cannot bypass the guard. Upload collision names are
   checked after allocation. Metadata and asset edits share one guarded commit.
7. Truncated trees, failed or incomplete blob reads, malformed relevant content,
   stale source SHAs and occupied rename destinations refuse publication.
8. An unrelated existing missing reference does not block cleanup of a different
   unused file. Post-publication cache failures still return success.

Start the production-component fixture.

```sh
npm run dev:fixtures -- --hostname 127.0.0.1 --port 4751
```

Open `/dev/fixtures/catalog-exchange` or run the isolated browser check.

```sh
node scripts/check-catalog-exchange-fixture.mjs
```

Set `PLAYWRIGHT_MODULE` when Playwright is installed outside this repository.
Set `CHROME_PATH` when selecting a browser executable. The script uses an isolated
headless context. `AFTER_IMAGE` captures the selected state at 1280 by 1000 pixels.

The browser verifies used Delete and Rename refusals, unused cleanup and retry,
Save of a replacement followed by old-file cleanup, stale missing-media Save and
draft preservation. Remove, Upload and Select still need a separate Save. Upload
and Save failures preserve the previous saved reference and leave the draft
available for retry.

The fixture renders production file editor, picker, menu and Rename components.
Injected in-memory API responses model the external write boundary. Its Save
button invokes the real file validator. It does not claim authenticated GitHub
write proof or replace the production Entry save regressions.

Open `/dev/fixtures/entry-rename` or run the production Entry regression.

```sh
node scripts/check-entry-rename-fixture.mjs
```

This check covers object, root-list and code editors. A held Rename succeeds,
then content Save refuses a missing replacement. Newer edits stay visible and
the recovery download retains the text, reference and acknowledged filename.
Retry saves to that filename without repeating Rename. Delayed stale or failed
destination reads preserve the draft, including failures received after the
retry succeeds. Create collision coverage observes both SWR consumers and checks
that only the returned suffixed path receives the new entry, while the original
entry keeps its content and revision. The code mode checks editor state only; it
does not extend typed media-reference checks to code content.

Local tests do not replace an authenticated private-sandbox Git write smoke,
completed Codex review, reviewed candidate VM verification or production rollout
gates. The local phase performs no push, publication, database migration or
customer repository mutation. Rich-text/code references, technical `.pages.yml`
changes and direct external Git writes remain outside this editorial guarantee.
