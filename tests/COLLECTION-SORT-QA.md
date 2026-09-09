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

- 33 tests pass, including real TanStack pagination/filtering/restoration and
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
- The owner explicitly authorized PR creation, Codex review/fix/re-review until
  clean, and merge after checks on 2026-09-09. PR #8 is open; review is pending.
  The standing workflow is now recorded in AGENTS.md and DOWNSTREAM.md.

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

## Codex review round 1

Review 5154729343 of head 6d610a9 reported three P2 findings: reject multi-select
fields (3968762306), resolve chained components (3968762315), and type-check
explicit ordered values (3968762323). All three have regression fixtures that
failed before the fixes and pass afterward. Component options now survive Zod
parsing so inherited multiple-selection settings can be checked; recursive
resolution uses the runtime's deep-merge/array-replacement semantics and rejects
missing/cyclic references. Ordered values must use the resolved stored primitive
type (select values are strings). The full suite has 33 passing tests.

The standard CI build passed at 6d610a9 (run 34354292736). New fixes require their
own green CI and a completed clean Codex re-review before merge. Local production
build limitations remain covered by that same unmodified CI job.
