const decimalIdPattern = /^[0-9]+$/;
const canonicalSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isDecimalId(value) {
  return typeof value === "string" && decimalIdPattern.test(value);
}

export function classifySteamRequestUrl(value, baseUrl = window.location.href) {
  try {
    const url = new URL(value, baseUrl);
    if (url.origin !== "https://steamcommunity.com") return null;

    const inventory = /^\/inventory\/([0-9]{17})\/753\/1\/?$/.exec(
      url.pathname,
    );
    if (inventory !== null) {
      return { kind: "inventory", steamId64: inventory[1] };
    }

    const validation = /^\/gifts\/([0-9]+)\/validateunpack\/?$/.exec(
      url.pathname,
    );
    return validation === null
      ? null
      : { assetId: validation[1], kind: "validate" };
  } catch {
    return null;
  }
}

export function isOwnGiftInventory(viewedSteamId64, accountSteamId64) {
  return (
    typeof viewedSteamId64 === "string" &&
    /^[0-9]{17}$/.test(viewedSteamId64) &&
    viewedSteamId64 === accountSteamId64
  );
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

export function shouldValidateSelectedGift({
  collectionRunning,
  gift,
  hasLocalObservation,
  ownInventory,
}) {
  return (
    ownInventory &&
    !collectionRunning &&
    gift !== undefined &&
    !hasLocalObservation &&
    needsPackageObservation(gift)
  );
}

export function selectInventoryGiftDisplayName(backendName, localName) {
  if (
    typeof localName === "string" &&
    localName.length > 0 &&
    (backendName === null || isUnknownPackageDisplayName(backendName))
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
    typeof value.accountSteamId64 !== "string" ||
    !/^[0-9]{17}$/.test(value.accountSteamId64) ||
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

  return { accountSteamId64: value.accountSteamId64, gifts };
}

export function parseValidateUnpackResponse(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !(value.success === 1 || value.success === true) ||
    typeof value.message !== "string" ||
    typeof value.owned !== "boolean" ||
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

export function parsePairingCreateResponse(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.authorizationUrl !== "string" ||
    !URL.canParse(value.authorizationUrl) ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    typeof value.pairingId !== "string" ||
    !opaqueTokenPattern.test(value.pairingId) ||
    typeof value.pollingSecret !== "string" ||
    !opaqueTokenPattern.test(value.pollingSecret)
  ) {
    throw new TypeError("Invalid Inventory.gift pairing response");
  }
  return value;
}

export function parsePairingPollResponse(value) {
  if (value?.status === "pending") return { status: "pending" };
  if (
    value?.status === "approved" &&
    typeof value.credential === "string" &&
    opaqueTokenPattern.test(value.credential)
  ) {
    return { credential: value.credential, status: "approved" };
  }
  throw new TypeError("Invalid Inventory.gift pairing poll response");
}

export function isUserscriptCredential(value) {
  return typeof value === "string" && opaqueTokenPattern.test(value);
}

export function classifyInventoryGiftStatus(status) {
  return {
    localOnly: status === 409,
    rateLimited: status === 429,
    reconnect: status === 401 || status === 403,
  };
}
