# Inventory.gift userscript guidance

## Purpose

This repository contains the public-facing Inventory.gift userscript. It is an
independent project from the Inventory.gift website repository at `../igift`.
The projects may document and consume an HTTP contract, but neither repository
owns the other's source or release process.

## Initial scope

The first milestone enhances Steam Community gift inventory pages only. It:

- observes Steam inventory responses for app `753`, context `1`;
- keeps `assetid` to `classid` mappings in memory;
- asks Inventory.gift for existing display names and effective SubIDs; and
- appends clearly labelled Inventory.gift information after Steam renders an
  item's detail panel.

Authenticated `validateunpack` collection and trade-offer pages are later
milestones. Do not add them incidentally to inventory-enrichment work.

## Safety and compatibility

- Never collect, inspect, log, transmit, or persist Steam cookies or session
  tokens.
- Treat IDs as decimal strings. Never convert SteamID64, asset IDs, or ClassIDs
  to JavaScript numbers.
- Do not replace Steam's names or block Steam's rendering or requests.
- Do not depend on Steam's generated CSS-module class names.
- Namespace inserted elements, CSS, events, and storage keys with
  `inventory-gift`.
- Treat page-context messages, Steam responses, and API responses as untrusted
  input and validate them before use.
- A failure in this script must leave Steam's normal page usable.
- Keep requested userscript permissions and connected hosts narrow.

## Product behavior

- Refer to Inventory.gift's value as an `Inventory.gift name`, not the true or
  actual name.
- Keep Steam's displayed name intact.
- Count distinct loaded ClassIDs as gift types; do not describe them as copies.
- Do not imply that every page of a Steam inventory has loaded.
- Keep collection separate from read-only enrichment and require a deliberate
  user action to begin each collection run.

## Verification

For behavior changes, add focused tests where the logic can be isolated. Run:

```sh
npm test
npm run build
```

Do not commit, publish, tag, or create a remote unless the current task
explicitly authorizes it.
