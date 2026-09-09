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
