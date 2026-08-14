const decimalIdPattern = /^[0-9]+$/;
const canonicalSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

export function validateUnpackAssetIdFromUrl(
  value,
  baseUrl = window.location.href,
) {
  try {
    const url = new URL(value, baseUrl);
    const match = /^\/gifts\/([0-9]+)\/validateunpack\/?$/.exec(url.pathname);
    return url.origin === "https://steamcommunity.com"
      ? (match?.[1] ?? null)
      : null;
  } catch {
    return null;
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

export function isUnknownPackageDisplayName(value) {
  return normalizeDisplayName(value).includes("unknown package");
}

export function needsPackageObservation(gift) {
  return (
    gift === null ||
    gift.subId === null ||
    isUnknownPackageDisplayName(gift.displayName)
  );
}

export function needsBulkPackageObservation(gift) {
  return gift !== null && gift.subId === null;
}

export function selectInventoryGiftDisplayName(backendName, localName) {
  if (
    typeof localName === "string" &&
    localName.length > 0 &&
    (backendName === null ||
      isUnknownPackageDisplayName(backendName))
  ) {
    return localName;
  }

  return backendName;
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
      typeof candidate.knownOwnerCount !== "string" ||
      !decimalIdPattern.test(candidate.knownOwnerCount) ||
      typeof candidate.slug !== "string" ||
      !canonicalSlugPattern.test(candidate.slug) ||
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
      knownOwnerCount: candidate.knownOwnerCount,
      slug: candidate.slug,
      subId: candidate.subId,
    });
  }

  return gifts;
}

export function parseValidateUnpackResponse(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !(value.success === 1 || value.success === true) ||
    typeof value.gift_name !== "string"
  ) {
    throw new TypeError("Invalid Steam validateunpack response");
  }

  const trimmedGiftName = value.gift_name.trim();
  const parsedSubId =
    typeof value.packageid === "number"
      ? value.packageid
      : typeof value.packageid === "string" &&
          decimalIdPattern.test(value.packageid)
        ? Number(value.packageid)
        : Number.NaN;

  if (
    trimmedGiftName.length > 300 ||
    !Number.isSafeInteger(parsedSubId) ||
    parsedSubId <= 0 ||
    parsedSubId > 2_147_483_647
  ) {
    throw new TypeError("Invalid Steam validateunpack response");
  }

  return {
    giftName: trimmedGiftName.length === 0 ? null : trimmedGiftName,
    subId: parsedSubId,
  };
}

export function parseObservationResponse(value, submittedCount) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.acceptedCount) ||
    value.acceptedCount < 0 ||
    value.acceptedCount > submittedCount
  ) {
    throw new TypeError("Invalid Inventory.gift observation response");
  }

  return value.acceptedCount;
}
