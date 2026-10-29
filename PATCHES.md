# Downstream patches

This file lists behavior that differs from the upstream tag underlying the
active FastMigrate release branch.

| ID | Status | Area | Purpose | Removal trigger |
| --- | --- | --- | --- | --- |
| FM-001 | Active | Dependency error UX | Show a safe, actionable English message and one explicit retry action when the GitHub API returns 5xx or cannot be reached. | An upstream release provides an equivalent classified error state and passes the FastMigrate CMS smoke. |
| FM-002 | Active | Dependency security | Pin patched Better Auth, Next.js, and Nodemailer versions and refresh compatible transitive dependencies so production audit has no known high or critical advisory. | An upstream release includes equivalent or newer reviewed versions and passes the FastMigrate security and CMS smokes. |
| FM-003 | Active | GitHub App setup | Generate a GitHub-valid App manifest with the accepted `emails` permission and GitHub-generated webhook secret. | Upstream includes the equivalent helper fixes and a newly created test App validates the flow. |

| FM-004 | Active | Collection images | Optional small/medium/large thumbnails and contain fit make image-led collections recognizable while retaining compact defaults. | Upstream supports equivalent per-image-field collection display options. |
| FM-005 | Active | Reference images | Optional image previews identify entries in reference choices and the selected single reference. | Upstream supports equivalent image-field previews in reference editors. |

| FM-006 | Active | Upload errors | Reject files above 7.5 MB before encoding and return explicit bounded-request errors before GitHub writes. | Upstream provides equivalent client and server upload validation. |
| FM-007 | Active | Collection sort presets | Named multi-field ordering aligns collection lists with website ordering without stored computed fields. | Upstream supports equivalent named multi-field collection sort presets. |
| FM-008 | Active | Entry duplication | Let configured collections create a validated draft copy through the normal save API without dispatching a build workflow. | Upstream supports equivalent opt-in collection-entry duplication through its normal save path. |
| FM-010 | Candidate | AI media classification | Asset-level labels with atomic image/metadata writes and derivative inheritance. | Upstream supports the equivalent native asset provenance contract. |
| FM-009 | Active | Downstream development loop | Exercise production client components locally, run an authenticated sandbox stack, and verify exact candidate commits on an isolated VM before merge. | Upstream provides equivalent fixture, sandbox, and immutable candidate-verification workflows. |

| FM-007 | Active | Configuration freshness | Check repository configuration during normal reads, update open editors automatically, preserve dirty drafts and reject saves made with obsolete configuration. | Upstream provides equivalent configuration synchronization and draft-preservation behavior. |
| FM-012 | Candidate | Draft collection ordering | Edit complete numeric collection groups locally and save atomically, with equivalent entry-list movement buttons. | Upstream supports equivalent opt-in draft ordering and atomic conflict-safe writes. |
| FM-011 | Active | Optional object defaults | Keep empty optional editor objects absent and apply child defaults only to populated optional objects before validation. | Upstream supports equivalent optional-object initialization and validation without changing duplicate-content preservation. |

Each active patch must remain a separate commit, include proportionate tests,
and avoid customer- or infrastructure-specific configuration.

## Optional object defaults

FM-011 leaves absent or recursively empty optional objects uninitialized, even
when their children have defaults, generated identities, or required fields.
Once an optional object contains meaningful content, validation initializes its
children through the normal editor defaults before checking required fields.
Existing values, including `false`, `0`, and media metadata, take precedence.

This changes editor initialization and the shared validation path. Default
`deepMap` read/write traversal retains its modeled shape so duplication can
preserve unknown empty descendants. Required objects, list bounds, block
discriminators, serialization, authorization, and configuration conflicts keep
their existing contracts. See `tests/OPTIONAL-OBJECTS-QA.md` for regression and
production-component fixture checks.

After an accepted save, the entry form mounts from the accepted file revision.
This discards cached controller defaults so cleared nested fields stay empty
across subsequent edits and saves. A response received after newer edits does
not replace that draft. The separate conflict SHA still advances for the next
save. See `tests/ENTRY-SAVE-RESET-QA.md` for the consecutive-save and pending-save
regressions.

Named form-value changes also register with the existing pending-save guard.
This preserves ordinary field and list edits made while a save is in flight.
Reset notifications update the comparison baseline without marking the editor
dirty. Rich-text draft registration remains available before its values flush.

## Collection image presentation

An image field may set `options.thumbnailSize: small | medium | large` (32/64/96 CSS pixels) and `options.thumbnailFit: cover | contain`. Defaults remain small/cover. These options affect the collection image cell only, preserve stored media paths and use the complete original for contain. Other uses of Thumbnail retain their current sizing and fit.

## Reference image previews

A reference field may set `options.image: image` to the path of an image field in
its target collection (nested paths and the `fields.` prefix are supported).
The editor shows 96px full-frame previews alongside the existing labels in the
dropdown and beneath the selected single reference. Search, keyboard selection,
and stored reference IDs retain their existing behavior. Multiple references
show previews in the dropdown and retain compact selected chips.

The references API reads the configured image field through its normal media
path transform and supplies the corresponding media source. Thumbnail loading
uses the existing repository authorization, including private repositories.
Missing images, unknown fields/media sources, disabled media, and external image
URLs retain selectable labels with a placeholder. Omit `options.image` to retain
the existing text-only editor. No image copies or content migrations are needed.

## Dependency security refresh — 2026-09-09

FM-002 refreshes Next.js/@next/env/eslint-config-next to 16.3.4 and Nodemailer
to 9.1.1. The lockfile updates the compatible Tiptap family to 3.31.3, Sharp
to 0.35.4, and patched build-tool dependencies. The CI audit threshold remains
`--omit=dev --audit-level=high`. Four moderate advisories remain in the legacy
Drizzle Kit -> @esbuild-kit -> esbuild chain; npm's proposed forced fix is an
incompatible Drizzle Kit downgrade and is deliberately not applied.

## Named collection sort presets

FM-007 adds opt-in `view.sortPresets` and `view.default.sortPreset`:

```yaml
view:
  fields: [title, year, order, category]
  sortPresets:
    - name: website
      label: Website order
      fields:
        - field: category
          order: asc
          values: [solo, group]
        - field: year
          order: desc
        - field: order
          order: asc
        - field: id
          order: asc
  default:
    sortPreset: website
```

Rules reference existing scalar fields, including nested or hidden fields. They
are evaluated in order. Numbers compare numerically; text uses localeCompare.
Optional `values` defines an explicit order using stored field values; the
comparator applies the same read transform as the collection API (including
custom date formats). Unlisted values follow listed values. Missing/null/empty values always follow populated values. File path is
the final tie breaker; configure a stable ID when the website uses one. Folders
follow `view.foldersFirst`; tree presets sort siblings, not across parents.

A named preset cannot coexist with `default.sort`/`default.order`. Duplicate
names/fields/values and unknown or non-scalar paths are configuration errors.
Multiple-select fields are non-scalar. Components are resolved through their
inheritance chain, including options; missing/cyclic references are rejected.
Explicit ordered values must match the stored primitive type: number, boolean,
or string (including single-select values).
Column sorting remains available; the selector displays Column sorting until a
preset is restored. Presets do not filter drafts, reorder content files or write
computed fields. Leave presets unset to retain the previous UI. See
`tests/COLLECTION-SORT-QA.md` for validation and rollout boundaries.

## Bounded uploads

Uploads have an explicit decimal 7.5 MB (7,500,000 byte) per-file limit. Both
media picker/drop-zone uploads and rich-text image uploads reject oversized
files before FileReader/base64 encoding. The original bytes are preserved for
accepted files.

The file API limits JSON requests to 10 MiB and validates decoded media size
before writing to GitHub. Oversized requests return JSON HTTP 413; incomplete
JSON returns HTTP 400. These routes bypass Next's body-cloning proxy so its
implicit truncation cannot preempt the bounded reader. POST and DELETE enforce
the same-origin check in the route itself, alongside existing authentication
and repository authorization. Other API routes retain the proxy.

`tests/upload-limits.test.mts` covers exact byte boundaries, valid maximum-size
JSON, chunked bodies and cancellation, malformed requests, Next's actual
matcher, same-origin checks, and the actual file route refusing unsafe inputs
without GitHub writes. This downstream self-hosted limit does not increase a
hosting provider's separate request limit (for example Vercel).

## Native collection-entry duplication

Collections may opt into a native duplicate button through
`operations.duplicate`. A boolean `true` uses the collection primary field and
English defaults. The object form can localize the editor prompt, select a
string/text field, and force a boolean top-level `draft` field to `true`:

```yaml
operations:
  create: true
  duplicate:
    label: Duplizieren
    description: Der zuletzt gespeicherte Stand wird als Entwurf kopiert.
    field: title
    fieldLabel: Neuer Titel
    button: Duplizieren
    draft: true
```

The editor reloads the latest saved source entry, copies its structured
content, applies the configured field and draft overrides, generates the new
filename with the collection's normal filename template, and POSTs it to the
existing file-save API with conflict renaming disabled. Normal create
permissions, schema validation, serialization, commit identity/message, cache
updates, and GitHub branch rules therefore remain authoritative. Unsaved form
changes are never copied. Unmodeled stored keys are preserved, while
schema-defined UUID identities are regenerated for the new entry. Preservation
also applies inside corresponding object and block list items. Root-list
collections, non-text duplicate fields, and prototype-related field paths are
rejected by configuration validation and guarded again at runtime. The prompt
field must participate in the filename template, and inferred primary fields
skip object lists that cannot produce a stable scalar filename value.

## Downstream development loop

FM-009 adds two deliberately separate local paths. `npm run dev:fixtures`
enables development-only routes that render production client components with
deterministic in-memory boundaries and no authentication, database, GitHub, or
external writes. Fixture routes return 404 in production builds even if their
flag is present. `npm run dev:local` starts PostgreSQL, applies migrations, and
runs the complete authenticated application against credentials from an
untracked `.env.local`; those credentials must belong to a dedicated sandbox
GitHub App and repository. The setup helper leaves webhooks disabled when the
CMS base URL is a local loopback address because GitHub cannot deliver to it;
use a public tunnel URL only when webhook delivery itself needs testing.

The production behavior remains unchanged when no boundary is injected. The
platform-side candidate command accepts only an immutable 40-character commit
SHA and provisions an isolated Tools VM with a temporary Pages CMS source pin.
It never invokes the production deployment path. This supplies candidate proof
before merge while the normal post-merge pinned VM gate remains authoritative
for a release.

## AI media classification (candidate)

FM-010 adds optional root `mediaMetadata: website/src/data/media-metadata.json`.
One version-1 JSON document stores repository-relative asset records with
classification (`generated`, `modified`, `unmarked`), source SHA-256 and Git blob
SHA. Each uploaded original has an explicit classification; generated website
sizes, crops and formats need no additional records. Manual variant relationships
are unsupported. Missing records are unmarked. Content image fields retain
their string paths. The native media tile/picker offers a shared
classification dialog and upload classification selector for static JPEG, PNG,
WebP and AVIF. GIF/SVG labeling is explicitly unsupported.

Classification, labeled uploads, replacement, rename and delete use fresh Git
refs and one base-tree commit for image plus metadata. Non-forced ref updates
reject concurrent edits. Existing record revisions and source blob SHAs reject
stale clients. Rename moves only the selected original record; deletion removes
only that record. Unknown metadata keys are preserved. Replacing bytes defaults
to unmarked unless a new explicit classification is selected. Unrelated originals
retain their own classifications. Media listings attach metadata in one
repository read, independent of which overlapping media source opened the asset. Original private media URLs
continue using the existing authorized thumbnail path.
Listings return source blob SHAs from the same fresh snapshot used for provenance
checks, allowing editors to reclassify external replacements despite a stale
folder cache. Returned sources with matching fingerprints remain trusted in a
truncated tree; omitted, changed or unverifiable sources still require review.
Atomic writes continue to reject truncated trees.

Development fixture: `/dev/fixtures/media-ai` with the production dialog and
an injected save boundary. The extension stays opt-in and must not be enabled
in customer configuration until this candidate is reviewed and deployed.

## Dependency security refresh — 2026-10-02

FM-002 refreshes Next.js/@next/env/eslint-config-next to 16.3.8 and Nodemailer
to 10.0.13. Production audit has zero high or critical findings with the same
CI threshold. The four existing moderate Drizzle Kit advisories remain.
The production build, existing tests, TypeScript, and a delivery-free
Nodemailer stream transport smoke validate the dependency boundary.

## Configuration freshness

Normal authenticated configuration reads check GitHub after a one-minute cache
interval. Initial repository layouts, configuration polling and content writes
force a synchronous check of `.pages.yml`. The configuration file SHA identifies
the editor schema independently of the parser version. A missing file removes
the cached schema; a failed check reports an error and does not overwrite it.

The client checks visible tabs every 60 seconds and on navigation, focus and
reconnection. Clean editors apply new configuration automatically. Dirty or
saving editors retain their active schema and values. The update action downloads
the current draft as JSON before loading the new fields. Entry background reads
must not reset a dirty draft or hide it after a revision-conflict response.
A confirmed missing configuration clears a clean editor. Dirty editors retain
the draft-download action before clearing the removed configuration. Transient
check failures keep the active editor and offer a retry. Configuration setup
remains available with an empty schema after removal.
Content creates, updates, duplicates and renames
send the active configuration SHA. The server rejects missing or obsolete
revisions with HTTP 409 before content transformation or GitHub writes.

This is a check before each write, not an atomic transaction with concurrent
external configuration commits. Existing GitHub file-conflict handling remains
in force. No promise is made to merge arbitrary schema changes into unsaved
content. Users keep the draft download for recovery in the updated form.

Branch create/delete webhooks remove configuration, file and metadata entries.
New App manifests subscribe to both events. Existing App subscriptions can keep
their current event set: normal read checks also correct missed events and reused
branch names without a webhook or the optional Cache dashboard.

Run `node --test tests/config-store.test.mts tests/configuration-api.test.mts`
and the development fixture at `/dev/fixtures/configuration`. Run the isolated
browser check with `node scripts/check-configuration-fixture.mjs` against the
fixture server. It requires Playwright, or a `PLAYWRIGHT_MODULE` path to an
existing installation. `AFTER_IMAGE` optionally records the selected PR image.

## Dependency security refresh — 2026-10-06

FM-002 refreshes the lockfile to Sharp 0.35.5 and source-map-js 1.2.2 to remove
the two high-severity findings that blocked the configuration release audit.
The compatible Drizzle Kit patch is 0.31.11. Its existing moderate development
loader advisories retain the previously accepted boundary. No forced downgrade
or major dependency update is included.

## Dependency security refresh — 2026-10-24

FM-002 pins Next.js, @next/env, and eslint-config-next to 16.4.3, Zod to
4.6.7, and @hookform/resolvers to 5.2.2. Better Auth keeps its existing
1.6.29 pin and shares the patched Zod version through its compatible range.
The production audit threshold remains `--omit=dev --audit-level=high`.

The Zod 4 migration retains configuration error messages and YAML locations,
including nested unions and component keys. Entry forms and the file API use
the current issue format. UUID fields retain their existing acceptance of
UUID-shaped identifiers through `z.guid()`. Constrained lists reject an
oversized input before validating each element. Unbounded lists retain their
existing behavior.

The updated React lint rule flags request-time `Date.now()` in the authenticated
async admin Server Component. A local rule exception documents that server
boundary without changing the page behavior or the repository lint rules.
`tests/zod-validation.test.mts` covers configuration diagnostics, real field
validators, entry resolver errors, parsed values, and constrained-list rejection.
The file API regression also checks that validation errors reach the response
before a GitHub write.

## Dependency security refresh — 2026-10-28

FM-002 pins Better Auth and its adapter cohort to 1.7.14, removing the high and
critical production audit findings without changing the audit threshold.
The custom GitHub profile result keeps the provider subject in `data.id` and
returns only mutable user fields, as required by Better Auth 1.7.
The Next.js cookie plugin runs last, after the email OTP hooks. Runtime tests
exercise GitHub identity/profile sync and encrypted OTP sign-in/session behavior
using the production auth configuration with isolated external I/O.

The [1.7 upgrade guide](https://github.com/better-auth/better-auth/blob/v1.7.14/docs/content/docs/guides/1-7-upgrade-guide.mdx)
confirms that the account schema is unchanged from 1.6; no database migration
or issuer backfill is required. Existing account identities and sessions are
preserved. The remaining production advisories are low or moderate.

## Draft collection ordering

FM-012 adds opt-in `view.reorder` to flat JSON object collections with explicit
`subfolders: false`. Select the numeric field and an existing named sort preset.
Rules before that field define fixed groups. Rules after it break ties.

```yaml
view:
  reorder:
    field: sortOrder
    sortPreset: website
  sortPresets:
    - name: website
      label: Website order
      fields:
        - field: department
          order: asc
        - field: sortOrder
          order: asc
        - field: id
          order: asc
```

Manual mode loads every collection member under fixed group headings. Dragging,
keyboard movement and the up/down buttons change per-group local drafts. The
Bereich filter retains hidden drafts; a single-group collection omits it. Select
groups show configured value labels. Save submits all complete groups and writes
changed numeric values in one Git commit. Unchanged groups retain their stored
values, including sparse or absent ranks. Discard restores every loaded group.
The endpoint validates all groups and prepares every numeric patch before any
Git object creation. It rejects changed branch/config
revisions and incomplete membership. It reads whole JSON documents and changes
only the configured numeric value. Hidden and optional numeric leaves are
supported. Nested object ancestors must be required and writable. Numeric
min/max/step constraints apply to the complete group. The order field cannot
drive filenames. Other formats, root lists, trees, and subfolders remain outside
this initial scope.

Entry list up/down buttons use the same pre-submit flush, RHF move, and collapse
state path as dragging. They keep the explicit Entry Save write boundary.
See `tests/COLLECTION-ORDER-QA.md` for local checks and navigation limits.
