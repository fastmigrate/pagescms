# Collection ordering local checks

Run `npm run dev:fixtures -- --hostname 127.0.0.1 --port 4593` and open
`/dev/fixtures/collection-reorder`. The fixture uses the production Collection
and CollectionReorder components with an injected in-memory request boundary.
It uses no authentication, database, GitHub, or customer repository.

The collection has more than 25 members in its first group and a second group.
Use **Reihenfolge bearbeiten** to load complete groups. Move entries with a drag
handle, keyboard, or the up/down buttons. Movement changes the draft only.
Check the saved content and save counter before and after explicit Save.
Discard restores saved order. Delayed saves disable movement and repeated saves.
Errors and conflicts keep the draft for inspection or retry. Group switches and
closing manual mode ask before discarding unsaved changes.

The component warns on document unload and intercepts ordinary same-tab link
clicks while dirty. It does not rewrite browser history. Browser Back can leave
an already mounted document through same-document history without a cancelable
unload event. Programmatic navigation outside the component has the same limit.
These routes do not claim a general router navigation blocker.

The `/dev/fixtures/entry-save-reset` fixture renders the real Entry notes object
list. Its up/down controls move both edited values and collapse state. Entry
Save remains the only write boundary.

Run the pure/config/route checks with `node --test tests/collection-order*.test.mts`.
Run the full downstream checks with `npm test`, `npx tsc --noEmit`, and
`npm run lint`. The isolated browser script records the exact exercised cases.
Real GitHub atomic writes require the dedicated private sandbox proof. Local
fixture success does not authorize deployment, customer configuration changes,
or production publication.
