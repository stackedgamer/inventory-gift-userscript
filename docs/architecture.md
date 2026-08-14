# Architecture

Status: supported inventory-only release

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
New ClassIDs are looked up in debounced batches of at most 100; larger sets are
chunked.

No inventory state is persisted by the userscript.

The bridge observes Steam's existing `validateunpack` fetch/XHR request when
the owner selects a gift. The validated response is retained in memory as a
local fallback for the detail block and submitted when the ClassID lookup is
unknown, the effective SubID is missing, or the backend name is an
unknown-package placeholder. The userscript does not issue a second request for
selection. Its explicit bulk collector uses the original page fetch reference
captured before bridge installation, preventing those intentional requests from
also entering the click-observation path.

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

## Collection phase

The `validateunpack` phase begins only after a user presses one action.
One run attempts all currently loaded recognized ClassIDs whose effective SubID
is missing, using one representative asset per ClassID. An effective SubID is
the durable checked marker; an unknown-package display name alone does not keep
a ClassID in the bulk queue. Requests are sequential, initially 500 ms apart,
and the UI exposes progress and cancellation. A request failure flushes
completed observations, stops the run, and reports the failure.

Completed results are checkpointed every 20 gifts and any remainder is
submitted when the run completes, is cancelled, or stops after an error. An
empty Steam `gift_name` is submitted as a missing name instead of invalidating
an otherwise valid package result. The delay is deliberately conservative and
is not a promise that Steam permits or will tolerate the traffic. Rate-limit or
authentication responses stop the run immediately.
