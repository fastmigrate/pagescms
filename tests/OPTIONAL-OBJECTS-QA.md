# Optional object defaults

An optional object is absent when it and all descendants are empty. Schema
defaults must not create it. A meaningful object receives the normal child
defaults before validation; required descendants still apply. Existing values
win over defaults, and `false` and `0` are meaningful.

## Automated regression

Run `node --test tests/optional-objects.test.mts`, then `npm test`,
`npx tsc --noEmit`, and `npm run lint` before review. Production builds use
`npm run build --ignore-scripts` so a local check does not run database
migrations.

The regression loads the production registry, schema helpers, serialization,
and file POST route. Only external session/GitHub/database/cache/configuration
boundaries are supplied for the route. Authentication decisions and repository
access checks execute normally.

Covered behavior:

- A title edit on a document with four collapsed object-list items and absent
  optional media preserves those items without inventing media objects.
- A title edit with hidden optional media under populated `hero` and `listing`
  objects saves while preserving their summaries.
- Empty/null nested objects remain absent despite child defaults or UUIDs.
- A newly populated media object receives hidden role/presentation defaults
  before validation and retains the ordinary media read/write transforms.
- Required objects and populated objects with a missing image source fail.
  Malformed scalar, array, and date object values fail.
- Nested optional parents, existing metadata, boolean/number values, list
  bounds, and block discriminators retain their contracts.
- The actual save route omits empty containers, writes defaults for populated
  objects, and rejects invalid media, stale configuration, missing sessions,
  and denied repository access before any write.
- Actual duplication preserves unknown empty/null descendants and list-item
  alignment while sanitizing modeled values. Empty-object omission is limited
  to initialization because duplication uses the default read/write shape to
  distinguish modeled fields from unknown descendants.

Against the release baseline, the title-edit regressions fail with four
`items.*.media.src` errors and hidden `hero.media.src`/`listing.media.src`
errors. The direct save of a newly populated media object also fails because
its hidden required metadata has not been initialized.

## Production form fixture

Run `npm run dev:fixtures -- --hostname 127.0.0.1 --port 4590` and open
`http://127.0.0.1:4590/dev/fixtures/optional-objects` in the in-session browser.
The route requires the explicit fixture flag and returns 404 in production.
It renders `EntryForm` with a fixed in-memory configuration/save boundary and
synthetic data. It has no authentication, database, or GitHub write boundary.

1. Select **Services shape**, change **Title**, and click **Save**.
2. Verify **Successful saves: 1** and the changed title in **Saved content**.
   All four item titles/bodies must remain, with no item media. The existing
   top-level decorative media and contain presentation must remain.
3. Select **Contact shape**, change **Title**, and click **Save**.
4. Verify **Successful saves: 1**, retained `hero`/`listing` summaries, and no
   media added beneath either object.

These steps verify the real form and its hidden/collapsed-field validation.
They do not claim a hosted deployment or a real GitHub write. A source-only
clear of an existing image still fails while other meaningful media metadata
remains; whole-object removal is outside this correction.

The required downstream CI and exact-reviewed-head candidate VM remain
separate release gates under `DOWNSTREAM.md` and the owning platform workflow.
