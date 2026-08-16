import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInventoryGiftStatus,
  classifySteamRequestUrl,
  isOwnGiftInventory,
  isUserscriptCredential,
  isUnknownPackageDisplayName,
  needsBulkPackageObservation,
  needsPackageObservation,
  normalizeDisplayName,
  parseAssetIdFromElementId,
  parseLookupResponse,
  parseObservationResponse,
  parsePairingCreateResponse,
  parsePairingPollResponse,
  parseValidateUnpackResponse,
  sanitizeInventoryAssets,
  selectInventoryGiftDisplayName,
  shouldValidateSelectedGift,
} from "../src/core.js";

globalThis.window = {
  location: { href: "https://steamcommunity.com/id/example/inventory/" },
};

test("classifies only supported Steam inventory and validation endpoints", () => {
  assert.deepEqual(
    classifySteamRequestUrl(
      "https://steamcommunity.com/inventory/76561197969050296/753/1?l=german&count=75",
    ),
    { kind: "inventory", steamId64: "76561197969050296" },
  );
  assert.equal(
    classifySteamRequestUrl(
      "https://steamcommunity.com/inventory/76561197969050296/753/6?l=english",
    ),
    null,
  );
  assert.equal(
    classifySteamRequestUrl(
      "https://example.com/inventory/76561197969050296/753/1",
    ),
    null,
  );
  assert.deepEqual(
    classifySteamRequestUrl(
      "https://steamcommunity.com/gifts/1600336606994018551/validateunpack",
    ),
    { assetId: "1600336606994018551", kind: "validate" },
  );
  assert.equal(
    classifySteamRequestUrl(
      "https://example.com/gifts/4077533287485796765/validateunpack",
    ),
    null,
  );
  assert.equal(
    classifySteamRequestUrl("/gifts/not-an-asset/validateunpack"),
    null,
  );
});

test("sanitizes gift assets without converting identifiers to numbers", () => {
  assert.deepEqual(
    sanitizeInventoryAssets({
      assets: [
        {
          appid: 753,
          contextid: "1",
          assetid: "4077533287485796765",
          classid: "6131612525",
        },
        { appid: 753, contextid: "6", assetid: "1", classid: "2" },
        { appid: 753, contextid: "1", assetid: 123, classid: "2" },
      ],
    }),
    [{ assetId: "4077533287485796765", classId: "6131612525" }],
  );
});

test("normalizes names only for comparison", () => {
  assert.equal(normalizeDisplayName("  Air   Brawl™  "), "air brawltm");
});

test("identifies gifts that still need a package observation", () => {
  assert.equal(isUnknownPackageDisplayName("Unknown Package 74935"), true);
  assert.equal(
    needsPackageObservation({ displayName: "Galactic Hitman", subId: null }),
    true,
  );
  assert.equal(
    needsPackageObservation({
      displayName: "Unknown package 74935",
      subId: 74935,
    }),
    true,
  );
  assert.equal(
    needsPackageObservation({ displayName: "Galactic Hitman", subId: 74935 }),
    false,
  );
});

test("bulk checks use only a missing effective SubID as their marker", () => {
  assert.equal(
    needsBulkPackageObservation({
      displayName: "Unknown package 74935",
      subId: 74935,
    }),
    false,
  );
  assert.equal(
    needsBulkPackageObservation({
      displayName: "Galactic Hitman",
      subId: null,
    }),
    true,
  );
  assert.equal(needsBulkPackageObservation(null), false);
});

test("selected-gift validation is limited to eligible owned inventory data", () => {
  const eligible = {
    collectionRunning: false,
    gift: { displayName: "Gift", subId: null },
    hasLocalObservation: false,
    ownInventory: true,
  };
  assert.equal(shouldValidateSelectedGift(eligible), true);
  assert.equal(
    shouldValidateSelectedGift({ ...eligible, gift: null }),
    true,
    "unknown ClassIDs remain locally checkable",
  );
  assert.equal(
    shouldValidateSelectedGift({
      ...eligible,
      gift: { displayName: "Gift", subId: 2574 },
    }),
    false,
  );
  assert.equal(
    shouldValidateSelectedGift({ ...eligible, gift: undefined }),
    false,
  );
  assert.equal(
    shouldValidateSelectedGift({ ...eligible, hasLocalObservation: true }),
    false,
  );
  assert.equal(
    shouldValidateSelectedGift({ ...eligible, ownInventory: false }),
    false,
  );
  assert.equal(
    shouldValidateSelectedGift({ ...eligible, collectionRunning: true }),
    false,
  );
});

test("parses only app 753 context 1 inventory element IDs", () => {
  assert.equal(
    parseAssetIdFromElementId("753_1_1183727730118484849"),
    "1183727730118484849",
  );
  assert.equal(parseAssetIdFromElementId("753_6_1183727730118484849"), null);
});

test("validates lookup responses", () => {
  assert.deepEqual(
    parseLookupResponse({
      accountSteamId64: "76561198329819384",
      gifts: [
        {
          classId: "6131612525",
          displayName: " TOTM ",
          knownOwnerCount: "4",
          slug: "totm",
          subId: null,
        },
      ],
    }),
    {
      accountSteamId64: "76561198329819384",
      gifts: [
        {
          classId: "6131612525",
          displayName: "TOTM",
          knownOwnerCount: "4",
          slug: "totm",
          subId: null,
        },
      ],
    },
  );
  assert.throws(
    () =>
      parseLookupResponse({
        accountSteamId64: "76561198329819384",
        gifts: [{ classId: "1", displayName: "", subId: 1 }],
      }),
    /Invalid Inventory\.gift lookup gift/,
  );
});

test("recognizes the connected account's own inventory without DOM markers", () => {
  assert.equal(
    isOwnGiftInventory("76561198329819384", "76561198329819384"),
    true,
  );
  assert.equal(
    isOwnGiftInventory("76561198329819384", "76561197969050296"),
    false,
  );
  assert.equal(isOwnGiftInventory(null, "76561198329819384"), false);
});

test("validates Steam package observations", () => {
  assert.deepEqual(
    parseValidateUnpackResponse({
      gift_name: "Unknown package 2574",
      message: "…",
      owned: true,
      packageid: "2574",
      success: 1,
    }),
    { giftName: "Unknown package 2574", subId: 2574 },
  );
  assert.deepEqual(
    parseValidateUnpackResponse({
      gift_name: "",
      message: "",
      owned: false,
      packageid: "27956",
      success: 1,
    }),
    { giftName: null, subId: 27956 },
  );
  assert.throws(
    () =>
      parseValidateUnpackResponse({
        gift_name: "Gift",
        message: "",
        owned: true,
        packageid: "not-a-subid",
        success: 1,
      }),
    /Invalid Steam validateunpack response/,
  );
});

test("validates observation acknowledgements", () => {
  assert.equal(parseObservationResponse({ acceptedCount: 2 }, 2), 2);
  assert.throws(
    () => parseObservationResponse({ acceptedCount: 3 }, 2),
    /Invalid Inventory\.gift observation response/,
  );
});

test("uses local names only when backend naming is absent or unknown", () => {
  assert.equal(
    selectInventoryGiftDisplayName(null, "Example Gift"),
    "Example Gift",
  );
  assert.equal(
    selectInventoryGiftDisplayName("Unknown Package 20", "Example Gift"),
    "Example Gift",
  );
  assert.equal(
    selectInventoryGiftDisplayName("Curated Gift", "Reported Gift"),
    "Curated Gift",
  );
});

test("validates pairing values and credential-shaped tokens", () => {
  const pairingId = "p".repeat(43);
  const pollingSecret = "s".repeat(43);
  const credential = "c".repeat(43);
  assert.deepEqual(
    parsePairingCreateResponse({
      authorizationUrl: `https://inventory.gift/userscript/connect?pairingId=${pairingId}`,
      expiresAt: "2026-08-16T10:10:00.000Z",
      pairingId,
      pollingSecret,
    }),
    {
      authorizationUrl: `https://inventory.gift/userscript/connect?pairingId=${pairingId}`,
      expiresAt: "2026-08-16T10:10:00.000Z",
      pairingId,
      pollingSecret,
    },
  );
  assert.deepEqual(parsePairingPollResponse({ status: "pending" }), {
    status: "pending",
  });
  assert.deepEqual(
    parsePairingPollResponse({ credential, status: "approved" }),
    { credential, status: "approved" },
  );
  assert.equal(isUserscriptCredential(credential), true);
  assert.equal(isUserscriptCredential("short"), false);
});

test("classifies reconnect, local-only, and rate-limit API behavior", () => {
  assert.deepEqual(classifyInventoryGiftStatus(401), {
    localOnly: false,
    rateLimited: false,
    reconnect: true,
  });
  assert.equal(classifyInventoryGiftStatus(403).reconnect, true);
  assert.equal(classifyInventoryGiftStatus(409).localOnly, true);
  assert.equal(classifyInventoryGiftStatus(429).rateLimited, true);
});
