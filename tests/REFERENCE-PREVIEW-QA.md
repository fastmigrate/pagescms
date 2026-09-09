# Reference previews and dependency refresh verification

## Automated coverage

`npm test` runs 22 tests. Reference API regressions execute the actual route,
JSON parser, schema helpers, image read transform and API error mapping. Only
GitHub/authentication I/O and unused React field components are substituted.
They cover search and saved-reference resolution, named/default media mapping,
nested/multiple images, omitted/invalid/disabled preview configuration, absent
or external images, empty-ID search alignment, and denial before collection reads.

Dependency smoke tests cover Tiptap's prototype-attribute security regression,
Sharp AVIF encoding/decoding, and Nodemailer composition with an in-memory
transport (no delivery). Existing dependency-error and image-size tests remain.

## Browser checks — 2026-09-09

A local fixture rendered the real reference editor and Thumbnail using 13 real
artwork files. Reference/media responses were simulated; these checks do not
claim hosted CMS acceptance or real GitHub authentication verification.

- Saved artwork resolves to its matching full-frame photo.
- Opening the dropdown lists all 13 choices with labels and photos.
- Keyboard selection and searching a distinct work number preserve the correct ID.
- Text-only configuration retains its original compact presentation.
- A successful private media response omitting the image produces a placeholder.
- Selecting another work remains possible when image files are missing.
- Public image-load failure produces a placeholder instead of a broken image.
- The actual rich-text editor renders headings, bold and lists after the Tiptap
  update; edits reach the Markdown output and undo removes the edit.

The Thumbnail review fix also cancels obsolete requests and keys displayed
results to the repository/branch/media/path, preventing prior results from
being displayed for a changed source.

## Release checks

Run the same installation, repository-settings validation, production audit,
test, full lint and build commands as `.github/workflows/ci.yml`. Build uses dummy
configuration with `--ignore-scripts`, avoiding the postbuild database migration.
Full lint currently has 17 warnings and no errors; React Doctor reports no
errors, with warnings about the existing plain image element and editor complexity.
Four moderate audit entries remain in the legacy Drizzle/esbuild dependency
chain; no high or critical entries remain in either full or production audit.
The security gate is unchanged. Merge/deployment and hosted verification are
separate from these local and PR checks.

## Off-screen loading regression — 2026-09-09

Reference image wrappers reserve their square layout and mount Thumbnail only
when IntersectionObserver reports them near the visible area. A browser fixture
with 100 options in distinct image directories made one media request for the
saved selection and four total after initially opening the list. Navigating to
work 10 loaded only the newly approached region (16 total), preserving selection
ID `id-10`. The previous eager mounting would resolve all 100 directories.
