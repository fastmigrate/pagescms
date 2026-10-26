# Verify cleared fields after saving

The development fixture renders the production `Entry` and `EntryForm`. Its injected fetch boundary stores one synthetic JSON file in memory and checks each submitted revision. It uses the production `sanitizeObject` helper. It does not use authentication, a database, GitHub, customer content, or mail.

Start the fixture server from this repository.

```sh
npm run dev:fixtures -- --hostname 127.0.0.1 --port 4593
```

Run the isolated browser regression in another terminal.

```sh
FIXTURE_URL=http://127.0.0.1:4593/dev/fixtures/entry-save-reset \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
STATE_IMAGE=/tmp/entry-save-reset-state.png \
node scripts/check-entry-save-reset-fixture.mjs
```

Omit `PLAYWRIGHT_MODULE` when `playwright` is locally available. `STATE_IMAGE` captures the first completed save at 1280 by 900 pixels, including a failing baseline. Use the same path variable with different filenames for selected Before and After images. `AFTER_IMAGE` optionally captures the completed regression. Images are local QA output and do not belong in Git.

The regression clears every opening-hours field and the image description. It verifies the saved optional parents are absent, the fields stay blank, and Save becomes disabled. It then edits the title and saves again without reloading. The saved record must still omit the deleted objects and retain meaningful `false` and `0` values.

The fixture can hold one save response. The regression submits one title, edits the title during that request, and releases the response. The newer draft must remain editable. Its next save must use the revision returned by the preceding response and persist that draft. The final Save button must become disabled.

The regression also appends a list item during another held save. The item must survive the response and persist on the next save. Initial list registration and accepted-save resets must keep the editor clean.

Before the production form key includes the accepted entry revision, the first save stores the omissions correctly but mounted controls restore old nested values. The browser regression must fail on that baseline and pass with the fix. The fixture does not replace production save logic or emulate the form reset.

This proof covers client state after accepted saves. It does not change serialization, server conflict handling, or repository writes. Required repository checks and current-head review still apply. Candidate and production deployment proof follow the downstream release policy separately. This fixture alone does not authorize a deployment.

The route requires `PAGESCMS_FIXTURES_ENABLED=true` in development and returns 404 in production through `areDevFixturesEnabled`.
