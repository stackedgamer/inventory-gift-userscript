# Inventory.gift for Steam inventories

Inventory.gift adds useful gift information to Steam Community inventories. It
shows the Inventory.gift display name, known owner count, and package ID (SubID)
beside the gift you select, without replacing Steam's own information.

The script is intentionally focused on gift inventories. It does not change
trade offer windows or other places where Steam displays gifts.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click **[Install Inventory.gift](https://raw.githubusercontent.com/stackedgamer/inventory-gift-userscript/main/dist/inventory-gift.user.js)**.
3. Tampermonkey will show the script and ask for confirmation. Choose
   **Install**.
4. Open or reload a Steam Community inventory.
5. Click on **Connect to Inventory.gift**.
6. Sign in to Inventory.gift, approve the request, and return to Steam.
7. Wait until the message says **Connected**. Gift details and SubID checks
   will not work until you connect.

Tampermonkey is the recommended userscript manager. Other compatible managers
may work, but are not currently tested.

## Use

Open a Steam profile's inventory and choose **Steam** → **Gifts**. When you
select a gift, an **Inventory.gift** section appears in Steam's detail panel.
Names, owner counts, and SubIDs are links when a useful destination is
available.

If the status says **Connect to Inventory.gift**, click it and follow the
sign-in steps. You can later click **Disconnect** in the same place.

In your own inventory, the script can also show a **Check missing SubIDs**
button. It checks each currently loaded gift type whose SubID is not yet known.
Checks run one at a time and results are saved in groups of 20, so stopping a
long run does not throw away everything already completed. You can cancel at
any time.

Only inventory pages Steam has loaded are included. If your inventory has more
pages, load them before starting the check if you want them included.

When you select an eligible gift in your own inventory, the script asks Steam
for its package information, shows it locally, and reports eligible missing
data. If SteamDB or another extension already started the same request, this
script reuses its response and does not send a duplicate. Use **Check missing
SubIDs** for the explicit bulk collection flow.

If Steam's request fails or its response can no longer be read, the
Inventory.gift status reports that capture error instead of failing silently.

## Updates and troubleshooting

Tampermonkey checks the same installation link for newer versions. Leave the
script enabled in Tampermonkey to receive updates.

If the Inventory.gift section does not appear:

- make sure the userscript is enabled;
- reload the Steam inventory page;
- confirm you are viewing the **Steam Gifts** inventory; and
- check whether [Inventory.gift](https://www.inventory.gift/) is
  available.

Problems and suggestions are welcome in
[GitHub Issues](https://github.com/stackedgamer/inventory-gift-userscript/issues).

## Privacy

The script sends loaded gift ClassIDs to Inventory.gift so it can look up the
matching display information using a private, narrowly scoped Inventory.gift
credential. When you deliberately check missing SubIDs—or
when Steam checks a gift you select in your own inventory—it may submit the
ClassID, returned SubID, and returned name as an observation. Inventory.gift
derives reporter identity from the credential and accepts reports only for
known gifts currently recorded in that account's inventory.

It does not send Steam cookies, session tokens, or inventory asset IDs to
Inventory.gift. See the [plain-language privacy details](docs/privacy.md) for
the complete data boundary.

## For developers

The readable source, tests, and build script are included so the published
userscript can be reviewed and reproduced. The installable file at
`dist/inventory-gift.user.js` is generated from `src/`; do not edit it by hand.

Requirements:

- Node.js 24
- npm 11

Run the test suite and rebuild the installable file:

```sh
npm test
npm run build
```

Before publishing a change, update the version in `package.json`, run both
commands, and commit the updated source and generated file together.

See [Architecture](docs/architecture.md) for implementation details.

## License

Inventory.gift is available under the [MIT License](LICENSE).
