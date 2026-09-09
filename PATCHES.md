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

Each active patch must remain a separate commit, include proportionate tests,
and avoid customer- or infrastructure-specific configuration.

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
