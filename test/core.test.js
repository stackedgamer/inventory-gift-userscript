import assert from "node:assert/strict";
import test from "node:test";

import {
  classIdChunks,
  isGiftInventoryUrl,
  isUnknownPackageDisplayName,
  needsBulkPackageObservation,
  needsPackageObservation,
  normalizeDisplayName,
  parseAssetIdFromElementId,
  parseLookupResponse,
  parseObservationResponse,
  parseValidateUnpackResponse,
  sanitizeInventoryAssets,
  selectInventoryGiftDisplayName,
  validateUnpackAssetIdFromUrl,
} from "../src/core.js";

globalThis.window = {
  location: { href: "https://steamcommunity.com/id/example/inventory/" },
};

test("recognizes only Steam gift inventory endpoints", () => {
  assert.equal(
    isGiftInventoryUrl(
      "https://steamcommunity.com/inventory/76561197969050296/753/1?l=german&count=75",
    ),
    true,
  );
  assert.equal(
    isGiftInventoryUrl(
      "https://steamcommunity.com/inventory/76561197969050296/753/6?l=english",
    ),
    false,
  );
  assert.equal(
    isGiftInventoryUrl("https://example.com/inventory/76561197969050296/753/1"),
    false,
  );
});

test("extracts asset IDs only from Steam validateunpack endpoints", () => {
  assert.equal(
    validateUnpackAssetIdFromUrl(
      "/gifts/4077533287485796765/validateunpack",
    ),
    "4077533287485796765",
  );
  assert.equal(
    validateUnpackAssetIdFromUrl(
      "https://example.com/gifts/4077533287485796765/validateunpack",
    ),
    null,
  );
  assert.equal(
    validateUnpackAssetIdFromUrl("/gifts/not-an-asset/validateunpack"),
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

test("deduplicates and chunks ClassIDs", () => {
  assert.deepEqual(classIdChunks(["3", "1", "3", "bad", "2"], 2), [
    ["3", "1"],
    ["2"],
  ]);
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
    [
      {
        classId: "6131612525",
        displayName: "TOTM",
        knownOwnerCount: "4",
        slug: "totm",
        subId: null,
      },
    ],
  );
  assert.throws(
    () =>
      parseLookupResponse({
        gifts: [{ classId: "1", displayName: "", subId: 1 }],
      }),
    /Invalid Inventory\.gift lookup gift/,
  );
});

test("validates Steam package observations", () => {
  assert.deepEqual(
    parseValidateUnpackResponse({
      gift_name: " Unknown package 75194 ",
      packageid: "75194",
      success: 1,
    }),
    { giftName: "Unknown package 75194", subId: 75194 },
  );
  assert.deepEqual(
    parseValidateUnpackResponse({
      gift_name: "",
      packageid: "27956",
      success: 1,
    }),
    { giftName: null, subId: 27956 },
  );
  assert.throws(
    () =>
      parseValidateUnpackResponse({
        gift_name: "Gift",
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
