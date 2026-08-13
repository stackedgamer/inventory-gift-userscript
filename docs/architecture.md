# Architecture

Status: initial proof-of-concept design

## Runtime boundary

The userscript has two small execution areas:

1. A page-context bridge reached through the userscript manager's
   `unsafeWindow` handle wraps `fetch` and `XMLHttpRequest` early enough to
   observe successful Steam inventory JSON responses. It clones/reads the
   response asynchronously and never delays or modifies Steam's original
   response. Using the page handle avoids depending on an inline injected
   script that Steam's Content Security Policy could reject.
2. The userscript sandbox validates the bridge payload, maintains in-memory
   indexes, contacts Inventory.gift, observes Steam's rendered DOM, and owns all
   inserted UI.

The bridge emits only asset records from URLs matching Steam Community
inventory context `753/1`. It has no access to Inventory.gift configuration or
API credentials.

## In-memory state

```text
assetId -> classId
classId -> lookup state
```

ClassIDs are deduplicated across initial and paginated inventory responses.
New ClassIDs are looked up in a debounced batch. The first API contract will
place a fixed upper bound on each request; larger sets are chunked.

No inventory state is persisted in the proof of concept.

## DOM integration

The implementation relies on stable, meaningful structures where available:

- inventory item IDs shaped like `753_1_{assetId}`;
- `.activeInfo` on the selected item;
- `[data-featuretarget="iteminfo"]` detail roots;
- the detail panel's semantic `h1`; and
- `#context_selector` for compact inventory-level status.

It does not depend on Steam's generated CSS-module class names. A
`MutationObserver` handles Steam replacing desktop and mobile detail trees.
Inserted nodes use `data-inventory-gift-*` markers and namespaced classes so
repeated observations are idempotent and coexist with extensions such as
SteamDB.

Steam's heading and description remain unchanged. The enhancement is visibly
labelled as Inventory.gift data.

## Failure behavior

Malformed Steam data, malformed API responses, network failures, and missing
DOM anchors are contained within the userscript. They may update the small
status message but must not stop Steam navigation, inventory pagination, or
item selection.

## Later collection phase

The later `validateunpack` phase begins only after a user presses one action.
One run attempts all currently loaded missing ClassIDs, using one
representative asset per ClassID. Requests are sequential, initially 500 ms
apart, and the UI will expose progress and cancellation. A request failure will
flush completed observations, stop the run, and report the failure.

The exact delay is an initial conservative value, not a promise that Steam
permits or will tolerate the traffic. Rate-limit or authentication responses
must stop the run immediately.
