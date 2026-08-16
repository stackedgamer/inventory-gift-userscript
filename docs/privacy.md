# Privacy

Status: authenticated inventory-only release

## Account connection

The script requires a separate Inventory.gift userscript credential. Pairing
opens Inventory.gift for explicit approval through the normal Steam sign-in.
The website session remains HttpOnly and is never exposed to the script. The
long-lived credential is never put in a URL and is stored only in the
userscript manager's private storage until disconnected, revoked, or rejected.
It authorizes only gift lookup and package observation submission.

## Inventory enrichment

The script reads Steam inventory `appid`, `contextid`, `assetid`, and `classid`.
Asset IDs remain in browser memory and are never submitted or persisted.
Authenticated lookup sends only distinct loaded ClassIDs. The script does not
read or send Steam cookies/session tokens, inventory descriptions, or browsing
history.

## Package observations

The bulk action covers only loaded, backend-recognized ClassIDs with missing
effective SubIDs. It runs Steam requests sequentially at 500 ms and checkpoints
every 20. Selecting an eligible gift in the connected account's own inventory
also makes a `validateunpack` request to Steam. If another extension has already
started that request, the script reuses its response instead of sending a
duplicate. These Steam requests contain the gift asset ID and use the existing
Steam Community browser session; Inventory.gift never receives the asset ID or
Steam session. A report contains only ClassID, returned package SubID, and
returned name or null; reporter identity comes from the Inventory.gift
credential.

Inventory.gift accepts a report only if the connected account currently owns
that known ClassID in its recorded inventory. Unknown/unrecorded ClassIDs remain
local. Evidence stores one current row/vote per account and ClassID, timestamps,
submission/conflict counts, and the latest non-empty name. It does not store an
IP address. Repeats never increase voting weight.

Authenticated distinct-account evidence may provisionally fill a missing SubID
and rename only an unknown-package canonical display name. Administrator and
Steam-derived values take precedence. Raw Steam gift names are never changed.
