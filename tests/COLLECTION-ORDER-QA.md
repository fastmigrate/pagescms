# Collection ordering local checks

Run `npm run dev:fixtures -- --hostname 127.0.0.1 --port 4593` and open
`/dev/fixtures/collection-reorder`. The fixture uses the production Collection
and CollectionReorder components with an injected in-memory request boundary.
It uses no authentication, database, GitHub, or customer repository.

The collection has more than 25 members in its first group and a second group.
Open **Seitenaktionen** and select **Reihenfolge bearbeiten** to load complete groups. Move entries with a drag
handle, keyboard, or the up/down buttons. Movement changes the draft only.
Check the saved content and save counter before and after explicit Save.
Discard restores saved order. Delayed saves disable movement and repeated saves.
Errors and conflicts keep every draft and the active filter for inspection or
retry. Multi-group collections start with all entries under separate group
headings. The Bereich filter changes visibility without discarding any draft.
Save includes every complete group in one request and commits changed groups
atomically. Discard restores every group, including hidden drafts. Closing
manual mode asks before discarding unsaved changes. The sticky action bar keeps
Save and the global dirty status available in long lists. A successful save
shows explicit confirmation and retains the active filter. Manual mode retains
the configured browse columns in aligned tables, with a leading drag handle and
movement buttons. Cells wrap and wide tables scroll within their collection.
The configured numeric column keeps its saved value while the draft moves, then
updates from the accepted snapshot after Save. Headers do not sort the draft.

The synthetic **Datum / Zeitraum** column chooses a custom-format date before
its event text. Every group includes a date plus event, empty date plus event,
and two empty sources. Check the date badge, text fallback, and empty cell in
browse and manual mode. Boolean columns retain both True and False badges.
The public fixture contains no customer titles or source data.

Open `/dev/fixtures/collection-reorder?single=1` for the single-group case.
There is no Bereich filter or redundant group heading. Select labels come from
the server snapshot. A single grouping field uses its value label; several
fields retain field-qualified labels. Each group owns its own drag context so
movement cannot cross group boundaries.

The component warns on document unload and intercepts ordinary same-tab link
clicks while dirty. It does not rewrite browser history. Browser Back can leave
an already mounted document through same-document history without a cancelable
unload event. Programmatic navigation outside the component has the same limit.
These routes do not claim a general router navigation blocker.

The `/dev/fixtures/entry-save-reset` fixture renders the real Entry notes object
list. Its up/down controls move both edited values and collapse state. Entry
Save remains the only write boundary.

Run the pure/config/route checks with `node --test tests/collection-columns.test.mts tests/collection-order*.test.mts tests/collection-sort-api.test.mts`.
Run the full downstream checks with `npm test`, `npx tsc --noEmit`, and
`npm run lint`. The isolated browser script records the exact exercised cases.
Real GitHub atomic writes require the dedicated private sandbox proof. Local
fixture success does not authorize deployment, customer configuration changes,
or production publication.
