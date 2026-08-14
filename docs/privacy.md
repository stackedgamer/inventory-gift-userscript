# Privacy

Status: current release

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

## Package observations

When Steam displays its own-inventory controls, the user may deliberately start
one collection run for all currently loaded recognized ClassIDs whose SubID is
missing. Unknown-package names with an effective SubID are already considered
checked for bulk purposes. The script sends one authenticated Steam request per
ClassID, sequentially and 500 milliseconds apart. It provides progress and
cancellation.

The intended submission contains:

- the ClassID;
- Steam's returned `packageid` as the reported SubID;
- Steam's returned `gift_name`, or a missing value when Steam returns it empty;
- the SteamID claimed for the viewed inventory.

The SteamID is provenance supplied by the client, not proof of identity. Raw
asset IDs, cookies, and Steam authentication material will not be submitted.
Inventory.gift retains submissions as evidence in a separate table.

Inventory.gift deduplicates identical evidence while retaining conflicts. Raw
evidence may be retained even when the ClassID is not yet known by the site.
For an existing gift, Inventory.gift may fill a missing effective SubID and may
rename a differing linked display name only when the current display name
contains `unknown package`. Raw Steam gift names, existing effective SubIDs,
and ordinary display names are not overwritten.

Completed observations are submitted after every 20 gifts and any remainder is
submitted when the run completes, is cancelled, or stops after an error.

When Steam performs its normal check for a selected gift in the owner's
inventory, the userscript observes that existing response rather than making a
second request. If the backend lookup is unknown, lacks an effective SubID, or
has an unknown-package name, the same observation fields are submitted and the
returned name/SubID are kept only in browser memory for immediate local display.
