const decimalIdPattern = /^[0-9]+$/;

export function isDecimalId(value) {
  return typeof value === "string" && decimalIdPattern.test(value);
}

export function isGiftInventoryUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return (
      url.origin === "https://steamcommunity.com" &&
      /^\/inventory\/[0-9]{17}\/753\/1\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function sanitizeInventoryAssets(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.assets)
  ) {
    return [];
  }

  const assets = [];

  for (const candidate of value.assets) {
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      String(candidate.appid) === "753" &&
      String(candidate.contextid) === "1" &&
      isDecimalId(candidate.assetid) &&
      isDecimalId(candidate.classid)
    ) {
      assets.push({ assetId: candidate.assetid, classId: candidate.classid });
    }
  }

  return assets;
}

export function classIdChunks(classIds, maximumSize) {
  if (!Number.isSafeInteger(maximumSize) || maximumSize < 1) {
    throw new TypeError("maximumSize must be a positive safe integer");
  }

  const unique = [...new Set(classIds.filter(isDecimalId))];
  const chunks = [];

  for (let index = 0; index < unique.length; index += maximumSize) {
    chunks.push(unique.slice(index, index + maximumSize));
  }

  return chunks;
}

export function normalizeDisplayName(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function parseAssetIdFromElementId(value) {
  const match = /^753_1_([0-9]+)$/.exec(value);
  return match?.[1] ?? null;
}

export function parseLookupResponse(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.gifts)
  ) {
    throw new TypeError("Invalid Inventory.gift lookup response");
  }

  const gifts = [];
  const seenClassIds = new Set();

  for (const candidate of value.gifts) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      !isDecimalId(candidate.classId) ||
      typeof candidate.displayName !== "string" ||
      candidate.displayName.trim().length === 0 ||
      !(
        candidate.subId === null ||
        (Number.isSafeInteger(candidate.subId) && candidate.subId > 0)
      ) ||
      seenClassIds.has(candidate.classId)
    ) {
      throw new TypeError("Invalid Inventory.gift lookup gift");
    }

    seenClassIds.add(candidate.classId);
    gifts.push({
      classId: candidate.classId,
      displayName: candidate.displayName.trim(),
      subId: candidate.subId,
    });
  }

  return gifts;
}
