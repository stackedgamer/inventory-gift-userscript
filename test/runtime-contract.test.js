import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/main.js", import.meta.url),
  "utf8",
);
const captureBridge = await readFile(
  new URL("../src/capture-bridge.js", import.meta.url),
  "utf8",
);
const metadata = await readFile(
  new URL("../src/metadata.txt", import.meta.url),
  "utf8",
);

test("published runtime targets beta and preauthorizes the canonical host", () => {
  assert.match(
    source,
    /const apiBaseUrl = "https:\/\/beta\.inventory\.gift"/,
  );
  assert.match(
    source,
    /const siteBaseUrl = "https:\/\/beta\.inventory\.gift"/,
  );
  assert.match(metadata, /^\/\/ @connect\s+beta\.inventory\.gift$/m);
  assert.match(metadata, /^\/\/ @connect\s+inventory\.gift$/m);
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(metadata, /@connect\s+(?:localhost|127\.0\.0\.1)/);
});

test("bulk validation uses the pre-bridge fetch and keeps checkpointing", () => {
  assert.match(
    source,
    /const steamFetch = unsafeWindow\.fetch\.bind\(unsafeWindow\)/,
  );
  assert.match(source, /await steamFetch\(/);
  assert.match(source, /observationCheckpointSize = 20/);
  assert.match(source, /validateUnpackDelayMs = 500/);
});

test("credentials stay in manager-private storage and authorize API calls", () => {
  assert.match(source, /GM_getValue\(credentialStorageKey/);
  assert.match(source, /GM_setValue\(credentialStorageKey, credential\)/);
  assert.match(source, /headers\.Authorization = `Bearer \$\{credential\}`/);
  assert.doesNotMatch(source, /steamId64:\s*inventorySteamId64/);
  assert.match(
    source,
    /function receiveValidateUnpack\(event\) \{\n  if \(credential === null\) return;/,
  );
});

test("unknown lookup results remain local and are never bulk candidates", () => {
  assert.match(source, /if \(gift === null\) \{/);
  assert.match(source, /unreportableClassIds\.add\(classId\)/);
  assert.match(source, /needsBulkPackageObservation\(gift\)/);
});

test("own-inventory reporting uses authenticated identity rather than a Steam DOM marker", () => {
  assert.match(
    source,
    /isOwnGiftInventory\(inventorySteamId64, connectedSteamId64\)/,
  );
  assert.doesNotMatch(source, /inventory_more_dselect_container/);
});

test("native capture uses Steam's Prototype responder and exposes failures", () => {
  assert.match(captureBridge, /Ajax\?\.Responders/);
  assert.match(captureBridge, /onComplete\(request, transport\)/);
  assert.match(captureBridge, /reportFailure/);
  assert.match(source, /lastCaptureError/);
  assert.doesNotMatch(captureBridge, /catch\(\(\) => undefined\)/);
});

test("gift selection validates explicitly without duplicating extension requests", () => {
  assert.match(source, /selectedGiftValidationDelayMs = 100/);
  assert.match(source, /scheduleSelectedGiftValidation\(\)/);
  assert.match(source, /new unsafeWindow\.AbortController\(\)/);
  assert.match(source, /externalValidateRequests\.has\(assetId\)/);
  assert.match(source, /"X-Requested-With": "Inventory\.gift"/);
  assert.match(source, /validateUnpack\(assetId, abortController\.signal\)/);
  assert.match(captureBridge, /eventNames\.validateStart/);
});
