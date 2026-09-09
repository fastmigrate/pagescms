# Named collection sort presets

## Outcome and scope

FM-006 adds opt-in named sort presets to collection views. A preset combines
existing scalar fields, each with its own direction and optional explicit value
order. A native, labelled selector shows the active preset and restores it after
a column-header sort. No content or computed keys are stored. Collections without
presets retain their existing view. Draft visibility is unchanged.

Implementation: schema validation, hidden table comparator columns, requesting
all preset fields (including non-visible stable IDs), default selection, and a
selector using the table's existing sort state. Sorting precedes pagination and
search retains it. Switching collections remounts the table with its own defaults.

## Verification — 2026-09-09

- 30 tests pass, including real TanStack pagination/filtering/restoration and
  recomputation, numeric ordering, explicit section order, ties, missing values,
  nested fields/folders, and actual configuration schema rejection fixtures.
- TypeScript passes. ESLint has zero errors and 17 pre-existing warnings.
- React Doctor: 83/100, one warning for the existing large Collection component;
  no new correctness/security finding.
- Standalone browser smoke uses the real CollectionTable and synthetic entries.
  Only Next Link is replaced by an anchor. Verified default ordering, second
  page, column sort, preset restoration, search, updated order, and a collection
  with no presets. Visual inspection confirms the labelled selector above rows.
- Local production builds are environment-limited: Turbopack cannot bind its
  worker port, and Webpack cannot fetch the existing Google Fonts. The standard
  unmodified CI build remains required before rollout.
- No production deployment or authenticated hosted acceptance is claimed.
- Feature-branch push was rejected by automatic approval review because public
  source-code transfer needs explicit owner authorization. The implementation
  is committed locally; PR creation and CI await that authorization.

## Repeat the browser smoke

After `npm ci` (the lockfile supplies esbuild through the build tooling):

```sh
node tests/fixtures/build-collection-sort.cjs /tmp/cms-sort-preview
python3 -m http.server 4497 --bind 127.0.0.1 --directory /tmp/cms-sort-preview
```

Open the local page. Initially Solo two A, Solo two B, Solo ten appear; page 2
contains Solo old then Group newest. Click title, select Website-Reihenfolge to
restore, search Solo, and click Move Solo ten first. Toggle legacy view to verify
that the selector disappears and ordinary column sorting remains usable.

## Rollout boundary

Submit the reviewed patch to the active downstream release branch. Require CI
and release review, then pin the accepted immutable revision through the shared
Tools deployment gate. Only afterward activate customer sortPresets settings and
perform an authenticated no-write smoke. Existing deployed CMS rejects the new
configuration keys. Do not push a customer opt-in ahead of the shared release.
