# Verify media retention locally

Run the focused route, schema and path-policy checks:

```sh
node --test tests/media-operations.test.mts tests/media-operations-route.test.mts
```

The actual file Delete and Rename routes use mocked external configuration,
session, GitHub and cache boundaries. Denied operations must return HTTP 403
without creating Git objects, updating a branch, or mutating media metadata.
Tests cover independent flags, legacy defaults, overlapping media and content
aliases, rename destinations, sibling directories, and disabled media.

Start the development fixture:

```sh
npm run dev:fixtures -- --hostname 127.0.0.1 --port 4751
```

Open `/dev/fixtures/catalog-exchange` or run the isolated browser check:

```sh
node scripts/check-catalog-exchange-fixture.mjs
```

Set `PLAYWRIGHT_MODULE` when Playwright is installed outside this repository.
Set `CHROME_PATH` when using an existing browser executable. The script launches
an isolated headless context. It rejects every API network request. `AFTER_IMAGE`
optionally captures the selected menu at 1280 by 1000 pixels.

1. Click **Remove** on the current file. The draft reference becomes empty.
   The saved reference and physical file remain present.
2. Click **Save**. The production required-file validator rejects the empty value.
3. Enable **Fail upload** and upload a PDF. The saved reference and files remain
   present. Disable the failure and upload again. Only the draft reference changes.
4. Enable **Fail save** and click **Save**. The previous saved reference remains.
   The uploaded file and new draft remain available for retry.
5. Disable the failure and click **Save**. The saved reference changes to the new
   file. The old file remains in the library.
6. Reset the fixture. Remove the reference and use **Select** to choose the other
   PDF. The saved reference changes only after **Save**.
7. Open the old file's library menu. **Delete** and **Rename** are absent.

The fixture renders the real file editor, picker and file menu. Uploads, library
reads and physical deletion use injected memory boundaries. Its separate Save
button models the content-write boundary and invokes the real file validator.
It does not exercise the production Entry save component or authenticated GitHub
writes. Existing Entry save regressions run in the full downstream test suite.

The route and component checks are local evidence. They do not replace an
authenticated private-sandbox write smoke, reviewed candidate VM verification,
or the separate production rollout gates. Enable website configuration only
after the supporting CMS revision is running.
