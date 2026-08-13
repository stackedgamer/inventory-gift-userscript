# Privacy

Status: proof-of-concept policy

## Read-only inventory enrichment

When a supported Steam gift inventory is open, the userscript processes these
fields from Steam's inventory response:

- `appid`;
- `contextid`;
- `assetid`; and
- `classid`.

Asset IDs are used only in browser memory to associate Steam's rendered item
with its ClassID. They are not included in Inventory.gift lookup requests and
are not persisted by the userscript.

The lookup request sends only distinct loaded ClassIDs. Inventory.gift returns
its display name and effective SubID for recognized ClassIDs. The script does
not read or transmit Steam cookies, session tokens, inventory descriptions, or
other browsing history.

## Future package observations

A later feature may let the owner of a Steam inventory deliberately start one
collection run for all currently loaded ClassIDs whose SubID is missing. That
feature is not implemented.

The intended submission contains:

- the ClassID;
- Steam's returned `packageid` as the reported SubID;
- Steam's returned `gift_name`; and
- the SteamID claimed for the viewed inventory.

The SteamID is provenance supplied by the client, not proof of identity. Raw
asset IDs, cookies, and Steam authentication material will not be submitted.
Inventory.gift will retain submissions as unresolved observations in a
separate table until a later review policy is adopted.

This policy must be updated before that feature is released.
