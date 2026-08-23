const apiBaseUrl = "https://beta.inventory.gift";
const siteBaseUrl = "https://beta.inventory.gift";
const lookupBatchSize = 100;
const lookupDebounceMs = 150;
const validateUnpackDelayMs = 500;
const selectedGiftValidationDelayMs = 100;
const observationCheckpointSize = 20;
const credentialStorageKey = "inventory-gift:credential";
const captureEvents = Object.freeze({
  failure: `inventory-gift:failure:${crypto.randomUUID()}`,
  inventory: `inventory-gift:assets:${crypto.randomUUID()}`,
  validate: `inventory-gift:validate:${crypto.randomUUID()}`,
  validateEnd: `inventory-gift:validate-end:${crypto.randomUUID()}`,
  validateStart: `inventory-gift:validate-start:${crypto.randomUUID()}`,
});
const steamFetch = unsafeWindow.fetch.bind(unsafeWindow);
const assetClassIds = new Map();
const capturedValidateResponses = new Map();
const giftLookups = new Map();
const localObservations = new Map();
const pendingClassIds = new Set();
const pendingObservedClassIds = new Set();
const submittedClassIds = new Set();
const submittingObservedClassIds = new Set();
const unreportableClassIds = new Set();
const externalValidateRequests = new Set();
let credential = GM_getValue(credentialStorageKey, null);
if (!isUserscriptCredential(credential)) {
  credential = null;
  GM_deleteValue(credentialStorageKey);
}
let inventorySteamId64 = null;
let connectedSteamId64 = null;
let lookupTimer = null;
let lookupInFlight = false;
let lastLookupError = null;
let lastCaptureError = null;
let selectedValidationAbortController = null;
let selectedValidationAssetId = null;
let selectedValidationAttempted = false;
let selectedValidationTimer = null;
let collectionCancelled = false;
let connectionState = {
  kind: credential === null ? "disconnected" : "connected",
  message: null,
};
let collectionState = { completed: 0, kind: "idle", message: null, total: 0 };

class InventoryGiftRequestError extends Error {
  constructor(message, status, code, retryAfter) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

function resetSelectedGiftValidation() {
  clearTimeout(selectedValidationTimer);
  selectedValidationTimer = null;
  selectedValidationAbortController?.abort();
  selectedValidationAbortController = null;
  selectedValidationAssetId = null;
  selectedValidationAttempted = false;
}

function clearCredential(message) {
  credential = null;
  connectedSteamId64 = null;
  GM_deleteValue(credentialStorageKey);
  connectionState = { kind: "disconnected", message };
  collectionCancelled = true;
  resetSelectedGiftValidation();
  capturedValidateResponses.clear();
  externalValidateRequests.clear();
  giftLookups.clear();
  localObservations.clear();
  pendingClassIds.clear();
  pendingObservedClassIds.clear();
  submittedClassIds.clear();
  unreportableClassIds.clear();
  lastCaptureError = null;
  lastLookupError = null;
}

function requestJson(url, body, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (options.authenticated !== false && credential !== null) {
      headers.Authorization = `Bearer ${credential}`;
    }
    GM_xmlhttpRequest({
      data: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method: options.method ?? "POST",
      onerror: () => reject(new Error("Inventory.gift request failed")),
      onload: (response) => {
        if (response.status < 200 || response.status >= 300) {
          let code = null;
          try {
            code = JSON.parse(response.responseText)?.error?.code ?? null;
          } catch {}
          const retryAfter = Number(
            response.responseHeaders?.match(/retry-after:\s*([0-9]+)/i)?.[1],
          );
          const failure = classifyInventoryGiftStatus(response.status);
          if (options.authenticated !== false && failure.reconnect) {
            clearCredential(
              "Connection expired or access was disabled. Reconnect to continue.",
            );
          }
          const message = failure.rateLimited
            ? `rate limited${Number.isFinite(retryAfter) ? `; retry in ${retryAfter}s` : ""}`
            : `request returned ${response.status}`;
          reject(
            new InventoryGiftRequestError(
              `Inventory.gift ${message}`,
              response.status,
              code,
              retryAfter,
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(response.responseText));
        } catch {
          reject(new Error("Inventory.gift returned invalid JSON"));
        }
      },
      ontimeout: () => reject(new Error("Inventory.gift request timed out")),
      timeout: 15_000,
      url,
    });
  });
}

async function connectUserscript() {
  if (connectionState.kind === "connecting") return;
  connectionState = { kind: "connecting", message: "Waiting for approval…" };
  renderAll();
  try {
    const created = parsePairingCreateResponse(
      await requestJson(
        `${apiBaseUrl}/api/userscript/v1/pairings`,
        {},
        { authenticated: false },
      ),
    );
    GM_openInTab(created.authorizationUrl, { active: true, insert: true });
    const expiresAt = Date.parse(created.expiresAt);
    while (Date.now() < expiresAt) {
      await delay(2_000);
      const polled = parsePairingPollResponse(
        await requestJson(
          `${apiBaseUrl}/api/userscript/v1/pairings/poll`,
          {
            pairingId: created.pairingId,
            pollingSecret: created.pollingSecret,
          },
          { authenticated: false },
        ),
      );
      if (polled.status === "pending") continue;
      credential = polled.credential;
      GM_setValue(credentialStorageKey, credential);
      connectionState = { kind: "connected", message: "Connected" };
      new Set(assetClassIds.values()).forEach(scheduleLookup);
      renderAll();
      return;
    }
    throw new Error("The connection request expired");
  } catch (error) {
    connectionState = {
      kind: "disconnected",
      message: error instanceof Error ? error.message : "Connection failed",
    };
    renderAll();
  }
}

async function disconnectUserscript() {
  if (credential === null) return;
  try {
    await requestJson(`${apiBaseUrl}/api/userscript/v1/credential`, undefined, {
      method: "DELETE",
    });
    clearCredential("Disconnected");
  } catch (error) {
    if (credential !== null) {
      connectionState = {
        kind: "connected",
        message:
          error instanceof Error ? error.message : "Could not disconnect",
      };
    }
  }
  renderAll();
}

function scheduleLookup(classId) {
  if (credential === null) return;
  if (giftLookups.has(classId)) return;
  pendingClassIds.add(classId);
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => void flushLookups(), lookupDebounceMs);
}

async function flushLookups() {
  if (lookupInFlight || pendingClassIds.size === 0) return;
  lookupInFlight = true;
  const batch = [...pendingClassIds].slice(0, lookupBatchSize);
  batch.forEach((classId) => pendingClassIds.delete(classId));

  try {
    const response = await requestJson(
      `${apiBaseUrl}/api/userscript/v1/gifts/lookup`,
      {
        classIds: batch,
      },
    );
    const lookup = parseLookupResponse(response);
    const gifts = lookup.gifts;
    connectedSteamId64 = lookup.accountSteamId64;
    const returned = new Set(gifts.map((gift) => gift.classId));

    gifts.forEach((gift) => giftLookups.set(gift.classId, gift));
    batch.forEach((classId) => {
      if (!returned.has(classId)) giftLookups.set(classId, null);
    });
    lastLookupError = null;
    flushCapturedValidateResponses();
  } catch (error) {
    batch.forEach((classId) => pendingClassIds.add(classId));
    lastLookupError =
      error instanceof Error ? error.message : "Inventory.gift lookup failed";
  } finally {
    lookupInFlight = false;
    renderAll();
    for (const classId of pendingObservedClassIds) {
      void maybeSubmitObservedValidate(classId);
    }
    if (pendingClassIds.size > 0 && lastLookupError === null) {
      lookupTimer = setTimeout(() => void flushLookups(), lookupDebounceMs);
    }
  }
}

function receiveAssets(event) {
  if (
    event.detail === null ||
    typeof event.detail !== "object" ||
    !isDecimalId(event.detail.steamId64)
  ) {
    return;
  }

  const assets = sanitizeInventoryAssets({ assets: event.detail.assets });
  inventorySteamId64 = event.detail.steamId64;

  for (const asset of assets) {
    assetClassIds.set(asset.assetId, asset.classId);
    scheduleLookup(asset.classId);

    const observation = capturedValidateResponses.get(asset.assetId);
    if (observation !== undefined) {
      capturedValidateResponses.delete(asset.assetId);
      receiveObservedValidate(asset.assetId, observation);
    }
  }

  renderAll();
}

function activeAssetId() {
  const active = document.querySelector(".item.app753.context1.activeInfo[id]");
  return active instanceof HTMLElement
    ? parseAssetIdFromElementId(active.id)
    : null;
}

function createEnhancement(gift, localObservation, steamName) {
  const block = document.createElement("section");
  block.className = "inventory-gift-detail";
  block.dataset.inventoryGiftDetail = "";

  const label = document.createElement("strong");
  label.textContent = "Inventory.gift";
  block.append(label);

  const backendDisplayName = gift?.displayName ?? null;
  const localGiftName = localObservation?.giftName ?? null;
  const displayName = selectInventoryGiftDisplayName(
    backendDisplayName,
    localGiftName,
  );

  if (
    displayName !== null &&
    normalizeDisplayName(displayName) !== normalizeDisplayName(steamName)
  ) {
    const name = document.createElement("span");
    name.textContent = `${displayName}`;
    block.append(name);
  }

  if (gift !== null) {
    const owners = document.createElement("a");
    owners.href = new URL(`/${gift.slug}`, siteBaseUrl).href;
    owners.rel = "noopener noreferrer";
    owners.target = "_blank";
    owners.textContent = `${BigInt(gift.knownOwnerCount).toLocaleString()} known ${
      gift.knownOwnerCount === "1" ? "owner" : "owners"
    }`;
    block.append(owners);
  }

  const effectiveSubId = gift?.subId ?? localObservation?.subId ?? null;
  if (effectiveSubId === null) {
    const subId = document.createElement("span");
    subId.textContent = "SubID unknown";
    block.append(subId);
  } else {
    const link = document.createElement("a");
    link.href = `https://steamdb.info/sub/${effectiveSubId}/`;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.textContent = `SubID ${effectiveSubId}`;
    block.append(link);
  }

  return block;
}

function renderDetails() {
  const assetId = activeAssetId();
  const classId = assetId === null ? null : assetClassIds.get(assetId);
  const gift =
    classId === null || classId === undefined
      ? undefined
      : giftLookups.get(classId);

  for (const root of document.querySelectorAll(
    '[data-featuretarget="iteminfo"]',
  )) {
    const heading = root.querySelector("h1");
    const existing = root.querySelector("[data-inventory-gift-detail]");

    if (
      credential === null ||
      !(heading instanceof HTMLElement) ||
      gift === undefined
    ) {
      existing?.remove();
      continue;
    }

    const expectedClassId = classId;
    const localObservation = localObservations.get(expectedClassId) ?? null;
    const renderSignature = JSON.stringify({ gift, localObservation });
    if (
      existing?.getAttribute("data-class-id") === expectedClassId &&
      existing.getAttribute("data-render-signature") === renderSignature
    ) {
      continue;
    }
    existing?.remove();
    const enhancement = createEnhancement(
      gift,
      localObservation,
      heading.textContent ?? "",
    );
    enhancement.dataset.classId = expectedClassId;
    enhancement.dataset.renderSignature = renderSignature;
    heading.insertAdjacentElement("afterend", enhancement);
  }
}

function renderStatus() {
  const anchor = document.querySelector("#context_selector");
  if (!(anchor instanceof HTMLElement)) return;

  let status = document.querySelector("[data-inventory-gift-status]");
  if (!(status instanceof HTMLElement)) {
    status = document.createElement("div");
    status.className = "inventory-gift-status";
    status.dataset.inventoryGiftStatus = "";
    anchor.insertAdjacentElement("afterend", status);
  }

  if (credential === null) {
    const signature = JSON.stringify(connectionState);
    if (status.dataset.renderSignature === signature) return;
    status.dataset.renderSignature = signature;
    status.replaceChildren();
    const text = document.createElement("span");
    text.textContent =
      connectionState.message === null
        ? "Inventory.gift: Connect to Inventory.gift to enable enrichment"
        : `Inventory.gift: ${connectionState.message}`;
    status.append(text);
    const button = document.createElement("button");
    button.className = "inventory-gift-collect";
    button.type = "button";
    button.disabled = connectionState.kind === "connecting";
    button.textContent =
      connectionState.kind === "connecting"
        ? "Connecting…"
        : "Connect to Inventory.gift";
    button.addEventListener("click", () => void connectUserscript());
    status.append(button);
    return;
  }

  const loadedClassIds = new Set(assetClassIds.values());
  const resolved = [...loadedClassIds].filter(
    (classId) => giftLookups.get(classId) != null,
  );
  const missingSubIds = resolved.filter(
    (classId) =>
      giftLookups.get(classId)?.subId === null &&
      !localObservations.has(classId),
  );
  const collectibleClassIds = missingSubIds.filter(
    (classId) =>
      !submittedClassIds.has(classId) &&
      !submittingObservedClassIds.has(classId),
  );

  let content = lastLookupError
    ? `Inventory.gift: ${lastLookupError}`
    : `Inventory.gift: ${resolved.length}/${loadedClassIds.size} loaded gift types matched · ${missingSubIds.length} missing SubIDs`;

  if (lastCaptureError !== null) {
    content += ` · ${lastCaptureError}`;
  }

  if (collectionState.kind === "running") {
    content += ` · Checking ${collectionState.completed}/${collectionState.total}…`;
  } else if (collectionState.message !== null) {
    content += ` · ${collectionState.message}`;
  }

  const canCollect = ownsViewedInventory() && collectibleClassIds.length > 0;
  const buttonLabel =
    collectionState.kind === "running"
      ? "Cancel"
      : `Check ${collectibleClassIds.length} missing ${
          collectibleClassIds.length === 1 ? "SubID" : "SubIDs"
        }`;
  const signature = JSON.stringify({
    buttonLabel:
      canCollect || collectionState.kind === "running" ? buttonLabel : null,
    content,
  });

  if (status.dataset.renderSignature === signature) return;
  status.dataset.renderSignature = signature;
  status.replaceChildren();

  const text = document.createElement("span");
  text.textContent = content;
  status.append(text);

  if (canCollect || collectionState.kind === "running") {
    const button = document.createElement("button");
    button.className = "inventory-gift-collect";
    button.type = "button";
    button.textContent = buttonLabel;
    button.addEventListener("click", () => {
      if (collectionState.kind === "running") {
        collectionCancelled = true;
        button.disabled = true;
        button.textContent = "Cancelling…";
      } else {
        void collectMissingSubIds();
      }
    });
    status.append(button);
  }
  if (collectionState.kind !== "running") {
    const disconnect = document.createElement("button");
    disconnect.className = "inventory-gift-disconnect";
    disconnect.type = "button";
    disconnect.textContent = "Disconnect";
    disconnect.addEventListener("click", () => void disconnectUserscript());
    status.append(disconnect);
  }
}

function collectionTargets() {
  const targets = new Map();

  assetClassIds.forEach((classId, assetId) => {
    const gift = giftLookups.get(classId);
    if (
      needsBulkPackageObservation(gift) &&
      !localObservations.has(classId) &&
      !submittedClassIds.has(classId) &&
      !unreportableClassIds.has(classId) &&
      !submittingObservedClassIds.has(classId) &&
      !targets.has(classId)
    ) {
      targets.set(classId, assetId);
    }
  });

  return [...targets].map(([classId, assetId]) => ({ assetId, classId }));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function validateUnpack(assetId, signal) {
  // This reference was captured before the bridge wrapped page fetch, so our
  // explicit selection and bulk requests do not re-enter external capture.
  const response = await steamFetch(
    `/gifts/${encodeURIComponent(assetId)}/validateunpack`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "X-Requested-With": "Inventory.gift",
      },
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(`Steam returned ${response.status}`);
  }

  return parseValidateUnpackResponse(await response.json());
}

function ownsViewedInventory() {
  return isOwnGiftInventory(inventorySteamId64, connectedSteamId64);
}

function selectedGiftValidationCandidate(assetId) {
  if (assetId === null) return null;
  const classId = assetClassIds.get(assetId);
  if (classId === undefined) return null;
  const gift = giftLookups.get(classId);
  return shouldValidateSelectedGift({
    collectionRunning: collectionState.kind === "running",
    gift,
    hasLocalObservation: localObservations.has(classId),
    ownInventory: credential !== null && ownsViewedInventory(),
  })
    ? { assetId, classId }
    : null;
}

async function validateSelectedGift(assetId) {
  selectedValidationTimer = null;
  if (activeAssetId() !== assetId) return;
  if (selectedGiftValidationCandidate(assetId) === null) return;
  if (externalValidateRequests.has(assetId)) {
    selectedValidationAttempted = true;
    return;
  }

  selectedValidationAttempted = true;
  const abortController = new unsafeWindow.AbortController();
  selectedValidationAbortController = abortController;
  try {
    const observation = await validateUnpack(assetId, abortController.signal);
    lastCaptureError = null;
    receiveObservedValidate(assetId, observation);
  } catch (error) {
    if (error?.name !== "AbortError") {
      lastCaptureError =
        error instanceof Error
          ? `Could not check selected gift: ${error.message}`
          : "Could not check selected gift";
      renderAll();
    }
  } finally {
    if (selectedValidationAbortController === abortController) {
      selectedValidationAbortController = null;
    }
  }
}

function scheduleSelectedGiftValidation() {
  const assetId = activeAssetId();
  if (assetId !== selectedValidationAssetId) {
    resetSelectedGiftValidation();
    selectedValidationAssetId = assetId;
  }
  if (
    selectedValidationAttempted ||
    selectedValidationTimer !== null ||
    selectedGiftValidationCandidate(assetId) === null
  ) {
    return;
  }
  if (externalValidateRequests.has(assetId)) {
    selectedValidationAttempted = true;
    return;
  }

  selectedValidationTimer = setTimeout(
    () => void validateSelectedGift(assetId),
    selectedGiftValidationDelayMs,
  );
}

async function maybeSubmitObservedValidate(classId) {
  const observation = localObservations.get(classId);
  const gift = giftLookups.get(classId);
  if (observation === undefined || gift === undefined || credential === null)
    return;
  if (gift === null) {
    pendingObservedClassIds.delete(classId);
    unreportableClassIds.add(classId);
    return;
  }
  if (!needsPackageObservation(gift)) {
    pendingObservedClassIds.delete(classId);
    return;
  }
  if (
    collectionState.kind === "running" ||
    submittedClassIds.has(classId) ||
    submittingObservedClassIds.has(classId)
  ) {
    return;
  }

  submittingObservedClassIds.add(classId);
  try {
    await submitObservations([{ classId, ...observation }]);
    pendingObservedClassIds.delete(classId);
  } catch (error) {
    if (
      error instanceof InventoryGiftRequestError &&
      classifyInventoryGiftStatus(error.status).localOnly
    ) {
      pendingObservedClassIds.delete(classId);
      unreportableClassIds.add(classId);
    }
    collectionState = {
      completed: 0,
      kind: "error",
      message:
        error instanceof Error
          ? `Could not submit selected gift: ${error.message}`
          : "Could not submit selected gift",
      total: 1,
    };
  } finally {
    submittingObservedClassIds.delete(classId);
    renderAll();
  }
}

function receiveObservedValidate(assetId, observation) {
  if (connectedSteamId64 === null) {
    capturedValidateResponses.set(assetId, observation);
    return;
  }
  if (!ownsViewedInventory()) return;

  const classId = assetClassIds.get(assetId);
  if (classId === undefined) {
    capturedValidateResponses.set(assetId, observation);
    return;
  }

  localObservations.set(classId, observation);
  pendingObservedClassIds.add(classId);
  renderAll();
  void maybeSubmitObservedValidate(classId);
}

function flushCapturedValidateResponses() {
  if (connectedSteamId64 === null) return;
  for (const [assetId, observation] of capturedValidateResponses) {
    if (!assetClassIds.has(assetId)) continue;
    capturedValidateResponses.delete(assetId);
    receiveObservedValidate(assetId, observation);
  }
}

function receiveValidateUnpack(event) {
  if (credential === null) return;
  if (
    event.detail === null ||
    typeof event.detail !== "object" ||
    !isDecimalId(event.detail.assetId)
  ) {
    return;
  }
  externalValidateRequests.delete(event.detail.assetId);

  try {
    const observation = parseValidateUnpackResponse(event.detail.response);
    lastCaptureError = null;
    receiveObservedValidate(event.detail.assetId, observation);
  } catch {
    lastCaptureError = "Steam returned an unsupported validateunpack response";
    renderAll();
  }
}

function receiveValidateStart(event) {
  if (
    credential === null ||
    event.detail === null ||
    typeof event.detail !== "object" ||
    !isDecimalId(event.detail.assetId)
  ) {
    return;
  }

  const assetId = event.detail.assetId;
  externalValidateRequests.add(assetId);
  if (selectedValidationAssetId === assetId) {
    clearTimeout(selectedValidationTimer);
    selectedValidationTimer = null;
    selectedValidationAbortController?.abort();
    selectedValidationAttempted = true;
  }
}

function receiveValidateEnd(event) {
  if (
    event.detail !== null &&
    typeof event.detail === "object" &&
    isDecimalId(event.detail.assetId)
  ) {
    externalValidateRequests.delete(event.detail.assetId);
  }
}

function receiveCaptureFailure(event) {
  if (event.detail === null || typeof event.detail !== "object") return;
  if (isDecimalId(event.detail.assetId)) {
    externalValidateRequests.delete(event.detail.assetId);
  }
  const status = Number.isSafeInteger(event.detail.status)
    ? ` (${event.detail.status})`
    : "";
  lastCaptureError = `${String(event.detail.message)}${status}`;
  renderAll();
}

async function submitObservations(observations) {
  if (inventorySteamId64 === null) {
    throw new Error("Steam inventory owner is unavailable");
  }

  for (let index = 0; index < observations.length; index += lookupBatchSize) {
    const batch = observations.slice(index, index + lookupBatchSize);
    let response;
    try {
      response = await requestJson(
        `${apiBaseUrl}/api/userscript/v1/subid-observations`,
        { observations: batch },
      );
    } catch (error) {
      if (
        error instanceof InventoryGiftRequestError &&
        classifyInventoryGiftStatus(error.status).localOnly
      ) {
        batch.forEach((observation) =>
          unreportableClassIds.add(observation.classId),
        );
      }
      throw error;
    }
    const acceptedCount = parseObservationResponse(response, batch.length);
    if (acceptedCount !== batch.length) {
      throw new Error("Inventory.gift did not recognize every gift");
    }
    batch.forEach((observation) => submittedClassIds.add(observation.classId));
  }
}

async function collectMissingSubIds() {
  if (collectionState.kind === "running" || !ownsViewedInventory()) {
    return;
  }

  clearTimeout(selectedValidationTimer);
  selectedValidationTimer = null;
  selectedValidationAbortController?.abort();
  selectedValidationAbortController = null;
  selectedValidationAttempted = true;

  const targets = collectionTargets();
  if (targets.length === 0) return;

  collectionCancelled = false;
  collectionState = {
    completed: 0,
    kind: "running",
    message: null,
    total: targets.length,
  };
  renderAll();
  let pendingObservations = [];
  let completed = 0;
  let failure = null;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (collectionCancelled) break;

    try {
      const observation = await validateUnpack(target.assetId);
      pendingObservations.push({ classId: target.classId, ...observation });
      completed += 1;
      collectionState.completed = completed;
      renderAll();

      if (pendingObservations.length === observationCheckpointSize) {
        await submitObservations(pendingObservations);
        pendingObservations = [];
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "Steam request failed";
      if (error instanceof InventoryGiftRequestError) pendingObservations = [];
      break;
    }

    if (index < targets.length - 1 && !collectionCancelled) {
      await delay(validateUnpackDelayMs);
    }
  }

  try {
    if (pendingObservations.length > 0) {
      await submitObservations(pendingObservations);
    }
  } catch (error) {
    failure =
      error instanceof Error ? error.message : "Observation submission failed";
  }

  collectionState = {
    completed,
    kind: failure === null ? "complete" : "error",
    message:
      failure !== null
        ? `Stopped after ${completed}/${targets.length}: ${failure}`
        : collectionCancelled
          ? `Cancelled after submitting ${completed}`
          : `Submitted ${completed} ${
              completed === 1 ? "observation" : "observations"
            }`,
    total: targets.length,
  };
  renderAll();
  for (const classId of pendingObservedClassIds) {
    void maybeSubmitObservedValidate(classId);
  }
}

function renderAll() {
  renderStatus();
  renderDetails();
  scheduleSelectedGiftValidation();
}

function installStyles() {
  GM_addStyle(`
    .inventory-gift-status {
      clear: both;
      color: #8f98a0;
      font-size: 12px;
      line-height: 1.4;
      margin: 6px 0 10px;
      padding-left: 10px;
    }
    .inventory-gift-collect {
      background: #1a9fff;
      border: 0;
      border-radius: 2px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      margin-left: 8px;
      padding: 4px 8px;
    }
    .inventory-gift-collect:hover { background: #66c0f4; }
    .inventory-gift-collect:focus-visible { outline: 2px solid #fff; }
    .inventory-gift-collect:disabled {
      cursor: default;
      opacity: 0.65;
    }
    .inventory-gift-disconnect {
      background: transparent;
      border: 0;
      color: #8f98a0;
      cursor: pointer;
      font: inherit;
      margin-left: 8px;
      padding: 4px;
      text-decoration: underline;
    }
    .inventory-gift-disconnect:focus-visible { outline: 2px solid #fff; }
    .inventory-gift-detail {
      align-items: flex-start;
      background: rgba(32, 83, 113, 0.28);
      border-left: 3px solid #67c1f5;
      color: #d6d7d8;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      gap: 3px;
      margin: 4px 0 8px;
      padding: 8px 10px;
    }
    .inventory-gift-detail strong { color: #67c1f5; }
    .inventory-gift-detail a {
      border-radius: 2px;
      color: #67c1f5;
      padding: 1px 3px;
      text-decoration: none;
    }
    .inventory-gift-detail a:hover {
      background: rgba(103, 193, 245, 0.18);
      color: #fff;
      text-decoration: underline;
    }
    .inventory-gift-detail a:focus-visible {
      outline: 2px solid #67c1f5;
      outline-offset: 1px;
    }
  `);
}

window.addEventListener(captureEvents.inventory, receiveAssets);
window.addEventListener(captureEvents.validate, receiveValidateUnpack);
window.addEventListener(captureEvents.validateEnd, receiveValidateEnd);
window.addEventListener(captureEvents.validateStart, receiveValidateStart);
window.addEventListener(captureEvents.failure, receiveCaptureFailure);
installSteamCaptureBridge(unsafeWindow, captureEvents);
installStyles();
new MutationObserver(renderAll).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
renderAll();
