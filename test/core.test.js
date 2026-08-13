import assert from "node:assert/strict";
import test from "node:test";

import {
  classIdChunks,
  isGiftInventoryUrl,
  normalizeDisplayName,
  parseAssetIdFromElementId,
  parseLookupResponse,
  sanitizeInventoryAssets,
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
      gifts: [{ classId: "6131612525", displayName: " TOTM ", subId: null }],
    }),
    [{ classId: "6131612525", displayName: "TOTM", subId: null }],
  );
  assert.throws(
    () =>
      parseLookupResponse({
        gifts: [{ classId: "1", displayName: "", subId: 1 }],
      }),
    /Invalid Inventory\.gift lookup gift/,
  );
});
