const apiBaseUrl = "http://127.0.0.1:4000";
const lookupBatchSize = 100;
const lookupDebounceMs = 150;
const bridgeEventName = `inventory-gift:assets:${crypto.randomUUID()}`;
const assetClassIds = new Map();
const giftLookups = new Map();
const pendingClassIds = new Set();
let lookupTimer = null;
let lookupInFlight = false;
let lastLookupError = null;

function installCaptureBridge(pageWindow) {
  const matchesInventory = (value) => {
    try {
      const url = new URL(String(value), pageWindow.location.href);
      return (
        url.origin === "https://steamcommunity.com" &&
        /^\/inventory\/[0-9]{17}\/753\/1\/?$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  };

  const emit = (value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      Array.isArray(value.assets)
    ) {
      const assets = value.assets.flatMap((candidate) => {
        if (candidate === null || typeof candidate !== "object") return [];
        return [
          {
            appid: candidate.appid,
            assetid: candidate.assetid,
            classid: candidate.classid,
            contextid: candidate.contextid,
          },
        ];
      });
      pageWindow.dispatchEvent(
        new pageWindow.CustomEvent(bridgeEventName, { detail: assets }),
      );
    }
  };

  const originalFetch = pageWindow.fetch;
  pageWindow.fetch = function inventoryGiftFetch(input, init) {
    const result = originalFetch.apply(this, arguments);
    const requestUrl = input instanceof pageWindow.Request ? input.url : input;

    if (matchesInventory(requestUrl)) {
      void result
        .then((response) => (response.ok ? response.clone().json() : null))
        .then(emit)
        .catch(() => undefined);
    }

    return result;
  };

  const originalOpen = pageWindow.XMLHttpRequest.prototype.open;
  pageWindow.XMLHttpRequest.prototype.open = function inventoryGiftOpen(
    method,
    url,
  ) {
    this.__inventoryGiftMatches = matchesInventory(url);
    return originalOpen.apply(this, arguments);
  };

  const originalSend = pageWindow.XMLHttpRequest.prototype.send;
  pageWindow.XMLHttpRequest.prototype.send = function inventoryGiftSend() {
    if (this.__inventoryGiftMatches === true) {
      this.addEventListener(
        "load",
        () => {
          if (this.status < 200 || this.status >= 300) return;
          try {
            emit(
              this.responseType === "json"
                ? this.response
                : JSON.parse(String(this.responseText)),
            );
          } catch {
            // Steam owns the request; capture failures must remain invisible.
          }
        },
        { once: true },
      );
    }

    return originalSend.apply(this, arguments);
  };
}

function requestJson(url, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      data: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      onerror: () => reject(new Error("Inventory.gift lookup failed")),
      onload: (response) => {
        if (response.status < 200 || response.status >= 300) {
          reject(
            new Error(`Inventory.gift lookup returned ${response.status}`),
          );
          return;
        }

        try {
          resolve(JSON.parse(response.responseText));
        } catch {
          reject(new Error("Inventory.gift returned invalid JSON"));
        }
      },
      ontimeout: () => reject(new Error("Inventory.gift lookup timed out")),
      timeout: 15_000,
      url,
    });
  });
}

function scheduleLookup(classId) {
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
    const gifts = parseLookupResponse(response);
    const returned = new Set(gifts.map((gift) => gift.classId));

    gifts.forEach((gift) => giftLookups.set(gift.classId, gift));
    batch.forEach((classId) => {
      if (!returned.has(classId)) giftLookups.set(classId, null);
    });
    lastLookupError = null;
  } catch (error) {
    batch.forEach((classId) => pendingClassIds.add(classId));
    lastLookupError =
      error instanceof Error ? error.message : "Inventory.gift lookup failed";
  } finally {
    lookupInFlight = false;
    renderAll();
    if (pendingClassIds.size > 0 && lastLookupError === null) {
      lookupTimer = setTimeout(() => void flushLookups(), lookupDebounceMs);
    }
  }
}

function receiveAssets(event) {
  const assets = sanitizeInventoryAssets({ assets: event.detail });

  for (const asset of assets) {
    assetClassIds.set(asset.assetId, asset.classId);
    scheduleLookup(asset.classId);
  }

  renderAll();
}

function activeAssetId() {
  const active = document.querySelector(".item.app753.context1.activeInfo[id]");
  return active instanceof HTMLElement
    ? parseAssetIdFromElementId(active.id)
    : null;
}

function createEnhancement(gift, steamName) {
  const block = document.createElement("section");
  block.className = "inventory-gift-detail";
  block.dataset.inventoryGiftDetail = "";

  const label = document.createElement("strong");
  label.textContent = "Inventory.gift";
  block.append(label);

  if (
    normalizeDisplayName(gift.displayName) !== normalizeDisplayName(steamName)
  ) {
    const name = document.createElement("span");
    name.textContent = `Inventory.gift name: ${gift.displayName}`;
    block.append(name);
  }

  if (gift.subId === null) {
    const subId = document.createElement("span");
    subId.textContent = "SubID unknown";
    block.append(subId);
  } else {
    const link = document.createElement("a");
    link.href = `https://steamdb.info/sub/${gift.subId}/`;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.textContent = `SubID ${gift.subId} · View on SteamDB`;
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
      !(heading instanceof HTMLElement) ||
      gift === undefined ||
      gift === null
    ) {
      existing?.remove();
      continue;
    }

    const expectedClassId = classId;
    if (existing?.getAttribute("data-class-id") === expectedClassId) continue;
    existing?.remove();
    const enhancement = createEnhancement(gift, heading.textContent ?? "");
    enhancement.dataset.classId = expectedClassId;
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

  const loadedClassIds = new Set(assetClassIds.values());
  const resolved = [...loadedClassIds].filter(
    (classId) => giftLookups.get(classId) != null,
  );
  const missingSubIds = resolved.filter(
    (classId) => giftLookups.get(classId)?.subId === null,
  );

  const content = lastLookupError
    ? `Inventory.gift: ${lastLookupError}`
    : `Inventory.gift: ${resolved.length}/${loadedClassIds.size} loaded gift types matched · ${missingSubIds.length} missing SubIDs`;

  if (status.textContent !== content) status.textContent = content;
}

function renderAll() {
  renderStatus();
  renderDetails();
}

function installStyles() {
  GM_addStyle(`
    .inventory-gift-status {
      clear: both;
      color: #8f98a0;
      font-size: 12px;
      line-height: 1.4;
      margin: 6px 0 10px;
    }
    .inventory-gift-detail {
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
    .inventory-gift-detail a { color: #67c1f5; }
  `);
}

window.addEventListener(bridgeEventName, receiveAssets);
installCaptureBridge(unsafeWindow);
installStyles();
new MutationObserver(renderAll).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
renderAll();
