# Architecture

Status: authenticated inventory-only release

## Runtime boundary

The separately tested page-context bridge wraps Steam's `fetch` and
`XMLHttpRequest` early and registers a responder with Steam's legacy
Prototype/Ajax stack. It clones successful app `753`/context `1` inventory and
`validateunpack` responses and never delays or modifies Steam. It has no access
to Inventory.gift credentials. The userscript sandbox validates bridge
messages, keeps asset/ClassID and lookup state in memory, contacts
Inventory.gift, and owns inserted UI. Matched request, JSON, or response-contract
failures appear in the userscript status instead of being silently ignored.

The only persisted value is the long-lived Inventory.gift userscript
credential, stored through manager-private `GM_*Value` APIs. Steam cookies,
website sessions, inventory assets, and lookup state are never persisted.

## Connection

Without a credential the script shows a connection action and performs no
lookup, enrichment, or collection. It creates a short-lived pairing, opens the
website authorization page with only the pairing ID, polls with the separate
private secret, and stores the credential returned after explicit approval.
Disconnect revokes that server credential before removing it locally. A 401 or
403 removes it locally and returns the UI to reconnect state.

## Inventory and observations

State is indexed as `assetId -> classId` and `classId -> lookup/local result`.
ClassIDs are deduplicated and looked up in batches of at most 100. Unknown
ClassIDs remain local and are not bulk candidates.

Authenticated lookup also returns the credential account's SteamID. The client
compares it with the inventory response owner to identify the account's own
inventory. This avoids relying on Steam's optional/replaceable owner-control
DOM. It does not add an ownership-only request: identity is returned by the
ClassID lookup already required for enrichment. The backend's authoritative
ownership check still runs when an observation is submitted.

Steam does not request `validateunpack` merely because a gift was selected. For
an owned-inventory selection that is unknown or still needs package metadata,
the sandbox waits briefly for another extension to start the request and then
uses the original page fetch to issue it itself. The bridge emits request-start
events, allowing an existing SteamDB/extension request to cancel the pending
Inventory.gift request and supply the response without duplication. Changing
selection aborts an in-flight Inventory.gift request. A captured result is
shown immediately and submitted only for a known eligible gift.

The bulk collector uses the same original page fetch, so its deliberate
requests cannot re-enter selection capture. It checks only recognized ClassIDs
with missing effective SubIDs, sequentially at 500 ms, checkpointing every 20.

The Steam contract is:

```text
GET https://steamcommunity.com/gifts/{assetId}/validateunpack
```

The JSON response has numeric/boolean `success`, decimal-string `packageid`,
boolean `owned`, string `message`, and string `gift_name`. `gift_name` may be
empty; the client then submits `null` for the optional reported name while
retaining the SubID.

Malformed responses and API/network failures remain contained. Authentication
failures reconnect, ownership rejection marks the ClassID local-only, and rate
limits stop the run with the server retry interval. Steam navigation continues.

## DOM integration

The script uses semantic/stable hooks: `753_1_{assetId}`, `.activeInfo`,
`[data-featuretarget="iteminfo"]`, the detail `h1`, and `#context_selector`.
Inserted markers/classes are namespaced. A `MutationObserver` handles Steam
replacing desktop/mobile trees. Steam's headings and descriptions are never
changed.
