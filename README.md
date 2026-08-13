# Inventory.gift userscript

This independent userscript project will add Inventory.gift information to
Steam Community gift inventory pages without delaying or replacing Steam's
normal interface.

The first proof of concept is read-only. As Steam loads gift inventory pages,
the script learns the relationship between the currently loaded asset IDs and
ClassIDs, asks Inventory.gift for known information, and adds a labelled block
to the selected gift's detail panel.

## Current status

Early proof of concept. The capture, validation, status UI, detail-panel
integration, and corresponding Inventory.gift lookup API are implemented in
their local repositories. Browser fixture and live-page compatibility testing
remain before the first supported release. If lookup is unavailable, the
userscript reports that failure and otherwise leaves Steam unchanged.

Trade offers and authenticated package discovery through Steam's
`validateunpack` endpoint are intentionally outside this first milestone.

## Development

Requirements:

- Node.js 24
- npm 11

Run the focused tests and build the installable file:

```sh
npm test
npm run build
```

The generated userscript is written to
`dist/inventory-gift.user.js`. The `dist` directory is not committed.

For local API development, edit the `apiBaseUrl` constant in `src/main.js`
before building. A configurable development setting will be added only when it
is needed for the first end-to-end integration.

## Permissions and privacy

The script is scoped to Steam Community inventory pages and may contact only
Inventory.gift. Its page-context access is used to observe the gift inventory
response and rendered page; it does not read or transmit Steam cookies or
authentication tokens. The read-only milestone sends batches of loaded
ClassIDs to Inventory.gift and keeps asset IDs in browser memory only.

See [Privacy](docs/privacy.md) for the current data boundary and
[Architecture](docs/architecture.md) for implementation details.

## Installation

Public installation instructions will be added after the lookup API and the
first supported release are ready. This repository currently has no published
release or remote update URL.

## License

A public-source license has not been selected yet. Do not redistribute a
release until the repository owner adds one.
