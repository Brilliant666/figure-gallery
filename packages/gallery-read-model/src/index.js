const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 2,
  excludedProductIds: [],
  excludedImageSha256: [],
  products: {},
  preferredCoverImage: {},
  manualNote: {},
});

const PROJECTION_IMAGE_HOSTS = new Set([
  "cdn.shopify.com",
  "images.goodsmile.info",
  "www.goodsmile.com",
]);

export const GALLERY_SOURCE_FAMILIES = Object.freeze([
  "goodsmile",
  "solaris",
  "japan-figure",
  "unknown",
]);

export const GALLERY_SOURCE_METADATA = Object.freeze({
  goodsmile: Object.freeze({ label: "Good Smile", role: "official" }),
  solaris: Object.freeze({
    label: "Solaris Japan",
    role: "catalog/retailer source",
  }),
  "japan-figure": Object.freeze({
    label: "Japan Figure",
    role: "catalog source",
  }),
  unknown: Object.freeze({
    label: "Unknown source",
    role: "unclassified source",
  }),
});

export const GALLERY_SOURCE_DISPLAY_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(GALLERY_SOURCE_METADATA).map(([family, value]) => [
      family,
      family === "unknown"
        ? "Unknown source family"
        : `${value.label} — ${value.role}`,
    ]),
  ),
);

export const GALLERY_CLASSIFICATIONS = Object.freeze([
  "likely_scale",
  "likely_prize",
  "likely_static",
]);

export const RECOMMENDED_GALLERY_SORT = Object.freeze({
  mode: "recommended",
  label: "推荐",
  signals: Object.freeze([
    "hasCover DESC",
    "imageCoverageBucket DESC",
    "sourceFamilyCount DESC",
    "hasGoodSmileEnrichment DESC",
    "normalizedTitle ASC",
    "prototypeId ASC",
  ]),
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter((value) => typeof value === "string" && value.trim()),
    ),
  ];
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeProjectionImageUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      PROJECTION_IMAGE_HOSTS.has(parsed.hostname.toLowerCase()) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function attachGalleryImageDigests(projection, digestUrl) {
  if (
    !projection ||
    !Array.isArray(projection.prototypes) ||
    typeof digestUrl !== "function"
  ) {
    throw new Error(
      "Gallery image digest preparation requires a Prototype projection and digest function.",
    );
  }
  return {
    ...projection,
    prototypes: projection.prototypes.map((prototype) => ({
      ...prototype,
      images: asArray(prototype?.images).map((image) => {
        const url = cleanText(image?.url || image?.sourceUrl);
        return {
          ...image,
          sha256: url ? digestUrl(url) : "",
        };
      }),
    })),
  };
}

function safeSourceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function normalizeGallerySourceFamily(value) {
  const normalized = cleanText(value, "unknown").toLowerCase();
  return GALLERY_SOURCE_FAMILIES.includes(normalized) ? normalized : "unknown";
}

function inferSourceFamily(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "solarisjapan.com" || host === "www.solarisjapan.com")
      return "solaris";
    if (host === "japan-figure.com" || host === "www.japan-figure.com")
      return "japan-figure";
    if (
      host === "goodsmile.com" ||
      host === "www.goodsmile.com" ||
      host === "goodsmile.info" ||
      host === "www.goodsmile.info" ||
      host === "images.goodsmile.info"
    )
      return "goodsmile";
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function normalizeGalleryPreferences(raw = {}) {
  const legacyCovers =
    raw.preferredCoverImage && typeof raw.preferredCoverImage === "object"
      ? raw.preferredCoverImage
      : {};
  const legacyNotes =
    raw.manualNote && typeof raw.manualNote === "object" ? raw.manualNote : {};
  const rawProducts =
    raw.products && typeof raw.products === "object" ? raw.products : {};
  const products = {};
  const productIds = new Set([
    ...Object.keys(rawProducts),
    ...Object.keys(legacyCovers),
    ...Object.keys(legacyNotes),
  ]);
  for (const productId of productIds) {
    if (typeof productId !== "string" || !productId) continue;
    const source =
      rawProducts[productId] && typeof rawProducts[productId] === "object"
        ? rawProducts[productId]
        : {};
    const preferredCoverValue = cleanText(
      source.preferredCoverImageUrl ||
        source.preferredCoverImageId ||
        legacyCovers[productId],
    );
    const preferredCoverImageId = /^[a-f\d]{64}$/iu.test(preferredCoverValue)
      ? preferredCoverValue.toLowerCase()
      : "";
    const preferredCoverImageUrl = safeProjectionImageUrl(preferredCoverValue);
    const manualNote = cleanText(source.manualNote || legacyNotes[productId]);
    const entry = {};
    if (preferredCoverImageId)
      entry.preferredCoverImageId = preferredCoverImageId;
    if (preferredCoverImageUrl)
      entry.preferredCoverImageUrl = preferredCoverImageUrl;
    if (manualNote) entry.manualNote = manualNote;
    if (Object.keys(entry).length > 0) products[productId] = entry;
  }
  return {
    schemaVersion: 2,
    excludedProductIds: uniqueStrings(asArray(raw.excludedProductIds)),
    excludedImageSha256: uniqueStrings(asArray(raw.excludedImageSha256))
      .filter((value) => /^[a-f\d]{64}$/iu.test(value))
      .map((value) => value.toLowerCase()),
    products,
    preferredCoverImage: Object.fromEntries(
      Object.entries(products)
        .filter(
          ([, value]) =>
            value.preferredCoverImageUrl || value.preferredCoverImageId,
        )
        .map(([productId, value]) => [
          productId,
          value.preferredCoverImageUrl || value.preferredCoverImageId,
        ]),
    ),
    manualNote: Object.fromEntries(
      Object.entries(products)
        .filter(([, value]) => value.manualNote)
        .map(([productId, value]) => [productId, value.manualNote]),
    ),
  };
}

export function mergeGalleryPrototypeNotes(values = []) {
  const sourcesByNote = new Map();
  for (const value of values) {
    const prototypeId = cleanText(value?.prototypeId);
    const note = cleanText(value?.note);
    if (!prototypeId || !note) continue;
    const sources = sourcesByNote.get(note) || [];
    if (!sources.includes(prototypeId)) sources.push(prototypeId);
    sourcesByNote.set(note, sources);
  }
  if (sourcesByNote.size === 0) return "";
  if (sourcesByNote.size === 1) return sourcesByNote.keys().next().value;
  return [...sourcesByNote.entries()]
    .map(([note, prototypeIds]) => ({
      note,
      prototypeIds: [...prototypeIds].sort(compareText),
    }))
    .sort((left, right) =>
      compareText(left.prototypeIds[0], right.prototypeIds[0]),
    )
    .map(({ note, prototypeIds }) => `[${prototypeIds.join(", ")}] ${note}`)
    .join("\n");
}

function resolvePrototypeAliasValue(value, aliases = {}) {
  let current = cleanText(value);
  if (!current) return "";
  const seen = new Set();
  while (Object.hasOwn(aliases, current)) {
    if (seen.has(current)) return "";
    seen.add(current);
    current = cleanText(aliases[current]);
    if (!current) return "";
  }
  return current;
}

export function normalizeGalleryPrototypeAliases(
  raw = {},
  validPrototypeIds = [],
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = new Set(
    validPrototypeIds.filter((value) => typeof value === "string" && value),
  );
  const aliases = Object.fromEntries(
    Object.entries(raw)
      .filter(
        ([retired, survivor]) =>
          typeof retired === "string" &&
          retired &&
          typeof survivor === "string" &&
          survivor &&
          retired !== survivor,
      )
      .sort(([left], [right]) => compareText(left, right)),
  );
  const normalized = {};
  for (const retired of Object.keys(aliases)) {
    const survivor = resolvePrototypeAliasValue(retired, aliases);
    if (
      survivor &&
      survivor !== retired &&
      (valid.size === 0 || valid.has(survivor))
    ) {
      normalized[retired] = survivor;
    }
  }
  return normalized;
}

export function canonicalizeGalleryPrototypePreferences(
  raw = {},
  aliases = {},
) {
  const preferences = normalizeGalleryPreferences(raw);
  const normalizedAliases = normalizeGalleryPrototypeAliases(aliases);
  if (Object.keys(normalizedAliases).length === 0) return preferences;

  const retiredBySurvivor = new Map();
  for (const [retired, survivor] of Object.entries(normalizedAliases)) {
    const values = retiredBySurvivor.get(survivor) || [];
    values.push(retired);
    retiredBySurvivor.set(survivor, values.sort(compareText));
  }

  const originalExcluded = new Set(preferences.excludedProductIds);
  const excludedProductIds = preferences.excludedProductIds.filter(
    (id) => !Object.hasOwn(normalizedAliases, id) && !retiredBySurvivor.has(id),
  );
  for (const [survivor, retiredIds] of [...retiredBySurvivor.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const retiredSignals = retiredIds.filter((id) => originalExcluded.has(id));
    const survivorSignal = originalExcluded.has(survivor);
    if (
      (retiredSignals.length === 0 && survivorSignal) ||
      (survivorSignal && retiredSignals.length === retiredIds.length)
    )
      excludedProductIds.push(survivor);
  }

  const candidatesBySurvivor = new Map();
  for (const [id, value] of Object.entries(preferences.products)) {
    const survivor = resolvePrototypeAliasValue(id, normalizedAliases) || id;
    const candidates = candidatesBySurvivor.get(survivor) || [];
    candidates.push({ id, value });
    candidatesBySurvivor.set(survivor, candidates);
  }
  const products = {};
  for (const [survivor, candidates] of [...candidatesBySurvivor.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    candidates.sort((left, right) => {
      if (left.id === survivor) return -1;
      if (right.id === survivor) return 1;
      return compareText(left.id, right.id);
    });
    const entry = {};
    for (const { value } of candidates) {
      if (entry.preferredCoverImageUrl || entry.preferredCoverImageId) break;
      if (value.preferredCoverImageUrl)
        entry.preferredCoverImageUrl = value.preferredCoverImageUrl;
      else if (value.preferredCoverImageId)
        entry.preferredCoverImageId = value.preferredCoverImageId;
    }
    const manualNote = mergeGalleryPrototypeNotes(
      candidates.map(({ id, value }) => ({
        prototypeId: id,
        note: value.manualNote,
      })),
    );
    if (manualNote) entry.manualNote = manualNote;
    if (Object.keys(entry).length > 0) products[survivor] = entry;
  }

  return normalizeGalleryPreferences({
    schemaVersion: preferences.schemaVersion,
    excludedProductIds,
    excludedImageSha256: preferences.excludedImageSha256,
    products,
  });
}

function normalizeProjectionClassification(value, category = "") {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
  if (["scale", "likely_scale"].includes(normalized)) return "likely_scale";
  if (["prize", "likely_prize"].includes(normalized)) return "likely_prize";
  if (["static", "likely_static"].includes(normalized)) return "likely_static";
  const categoryValue = cleanText(category).toLowerCase();
  if (/prize|景品/iu.test(categoryValue)) return "likely_prize";
  if (/scale|比例/iu.test(categoryValue)) return "likely_scale";
  return "unknown";
}

function normalizeProjectionSource(source) {
  if (!source || typeof source !== "object") return null;
  const url = safeSourceUrl(source.url);
  if (!url) return null;
  const sourceFamily = normalizeGallerySourceFamily(
    source.sourceFamily || inferSourceFamily(url),
  );
  return {
    url,
    sourceFamily,
    label: GALLERY_SOURCE_METADATA[sourceFamily].label,
  };
}

function normalizeProjectionCatalogItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = cleanText(item.id || item.catalogItemId || item.catalogItemKey);
  if (!id) return null;
  const sources = asArray(item.sources)
    .map(normalizeProjectionSource)
    .filter(
      (source, index, all) =>
        source &&
        all.findIndex((candidate) => candidate?.url === source.url) === index,
    );
  for (const sourceUrl of asArray(item.sourceUrls)) {
    const normalized = normalizeProjectionSource({
      url: sourceUrl,
      sourceFamily: item.sourceFamily,
    });
    if (normalized && !sources.some((source) => source.url === normalized.url))
      sources.push(normalized);
  }
  return {
    id,
    title: cleanText(item.title, id),
    manufacturer: cleanText(
      item.manufacturer || item.manufacturerText,
      "unknown",
    ),
    category: cleanText(item.category, "unknown"),
    classification: normalizeProjectionClassification(
      item.classification || item.type,
      item.category,
    ),
    scale: cleanText(item.scale, "unknown"),
    release: cleanText(item.release || item.releaseDate),
    source: cleanText(item.source),
    sources,
  };
}

function normalizeProjectionImage(image, prototypeId, excludedImages, order) {
  if (!image || typeof image !== "object") return null;
  const url = safeProjectionImageUrl(image.url || image.sourceUrl);
  const sha256 = cleanText(image.sha256).toLowerCase();
  if (!url || !/^[a-f\d]{64}$/u.test(sha256)) return null;
  const sourceFamily = normalizeGallerySourceFamily(image.sourceFamily);
  return {
    id: cleanText(image.id, `image-ref-${sha256.slice(0, 16)}`),
    sha256,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    bytes: null,
    mime: cleanText(image.mime, "image/jpeg"),
    sourceUrl: url,
    url,
    mediaUrl: url,
    catalogItemId: cleanText(image.catalogItemId || image.catalogItemKey),
    sourceFamily,
    alt: cleanText(image.alt, `Reference image for ${prototypeId}`),
    excluded: excludedImages.has(sha256),
    isOfficialPrimary: sourceFamily === "goodsmile" && image.isMain === true,
    isMain: image.isMain === true,
    remote: true,
    order,
  };
}

function coverOrder(left, right) {
  return (
    compareText(left.catalogItemId, right.catalogItemId) ||
    Number(right.isMain) - Number(left.isMain) ||
    compareText(left.id, right.id)
  );
}

function selectProjectionCover(images, preferredUrl) {
  const available = images.filter((image) => !image.excluded);
  if (preferredUrl) {
    const preferred = available.find((image) => image.url === preferredUrl);
    if (preferred)
      return {
        image: preferred,
        source: "manual_override",
        preferredCoverUnavailable: false,
      };
  }
  const ordered = [...available].sort(coverOrder);
  const selected =
    ordered.find(
      (image) => image.sourceFamily === "goodsmile" && image.isMain,
    ) ||
    ordered.find((image) => image.isMain) ||
    ordered.find((image) => image.sourceFamily === "goodsmile") ||
    ordered[0] ||
    null;
  return {
    image: selected,
    source: selected ? "projection_rule" : "none",
    preferredCoverUnavailable: Boolean(preferredUrl),
  };
}

function normalizedTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function imageCoverageBucket(count) {
  if (count >= 8) return 4;
  if (count >= 4) return 3;
  if (count >= 2) return 2;
  if (count >= 1) return 1;
  return 0;
}

export function galleryRecommendationSignals(prototype) {
  const sourceFamilies = new Set(
    [
      ...asArray(prototype.images).map((image) => image.sourceFamily),
      ...asArray(prototype.sources).map((source) => source.sourceFamily),
    ].filter((family) => family && family !== "unknown"),
  );
  return {
    hasCover: prototype.coverImage || prototype.cover ? 1 : 0,
    imageCoverageBucket: imageCoverageBucket(asArray(prototype.images).length),
    sourceFamilyCount: sourceFamilies.size,
    hasGoodSmileEnrichment: sourceFamilies.has("goodsmile") ? 1 : 0,
  };
}

export function compareGalleryRecommendation(left, right) {
  const leftSignals = galleryRecommendationSignals(left);
  const rightSignals = galleryRecommendationSignals(right);
  for (const name of [
    "hasCover",
    "imageCoverageBucket",
    "sourceFamilyCount",
    "hasGoodSmileEnrichment",
  ]) {
    if (leftSignals[name] !== rightSignals[name])
      return rightSignals[name] - leftSignals[name];
  }
  return (
    compareText(normalizedTitle(left.title), normalizedTitle(right.title)) ||
    compareText(left.prototypeId || left.id, right.prototypeId || right.id)
  );
}

function normalizeProjectionPrototype(prototype, preferences) {
  if (!prototype || typeof prototype !== "object") return null;
  const id = cleanText(
    prototype.prototypeId || prototype.id || prototype.projectionKey,
  );
  if (!id) return null;
  const excludedImages = new Set(preferences.excludedImageSha256);
  const images = asArray(prototype.images)
    .map((image, index) =>
      normalizeProjectionImage(image, id, excludedImages, index),
    )
    .filter(
      (image, index, all) =>
        image &&
        all.findIndex((candidate) => candidate?.url === image.url) === index,
    );
  const catalogItems = asArray(prototype.catalogItems)
    .map(normalizeProjectionCatalogItem)
    .filter(Boolean);
  const sources = asArray(prototype.sources)
    .map(normalizeProjectionSource)
    .filter(
      (source, index, all) =>
        source &&
        all.findIndex((candidate) => candidate?.url === source.url) === index,
    );
  for (const item of catalogItems) {
    for (const source of item.sources) {
      if (!sources.some((candidate) => candidate.url === source.url))
        sources.push(source);
    }
  }
  const preference = preferences.products?.[id] || {};
  const preferredCoverImageUrl = cleanText(preference.preferredCoverImageUrl);
  const cover = selectProjectionCover(images, preferredCoverImageUrl);
  const representative =
    catalogItems.find((item) => item.id === cover.image?.catalogItemId) ||
    catalogItems[0] ||
    null;
  const manufacturers = uniqueStrings(
    [
      ...asArray(prototype.manufacturers),
      prototype.manufacturer,
      ...catalogItems.map((item) => item.manufacturer),
    ].map((value) => cleanText(value)),
  ).sort(compareText);
  const classification = normalizeProjectionClassification(
    prototype.classification || prototype.type || prototype.figureType,
    prototype.category || representative?.category,
  );
  const catalogItemIds = uniqueStrings([
    ...asArray(prototype.catalogItemIds),
    ...asArray(prototype.catalogItemKeys),
    ...catalogItems.map((item) => item.id),
  ]);
  return {
    id,
    prototypeId: id,
    membershipFingerprint: /^[a-f\d]{64}$/iu.test(
      cleanText(prototype.membershipFingerprint),
    )
      ? cleanText(prototype.membershipFingerprint).toLowerCase()
      : "",
    viewMode: "prototype_projection",
    catalogItemIds,
    groupedCatalogItemCount: catalogItemIds.length,
    title: cleanText(prototype.title, `Prototype ${id}`),
    design: cleanText(prototype.title, `Prototype ${id}`),
    manufacturer: cleanText(
      prototype.manufacturer ||
        representative?.manufacturer ||
        manufacturers[0],
      "unknown",
    ),
    manufacturers,
    classification,
    category: cleanText(
      prototype.category || representative?.category,
      "unknown",
    ),
    scale: cleanText(
      prototype.scale ||
        catalogItems.find((item) => item.scale !== "unknown")?.scale,
      "unknown",
    ),
    charactersHint: asArray(prototype.charactersHint).filter(
      (value) => typeof value === "string",
    ),
    images,
    coverImage: cover.image,
    coverSelectionSource: cover.source,
    preferredCoverUnavailable: cover.preferredCoverUnavailable,
    preferredCoverImageUrl,
    preferredCoverImageId: preferredCoverImageUrl,
    excluded: preferences.excludedProductIds.includes(id),
    note: cleanText(preference.manualNote || preferences.manualNote[id]),
    catalogItems,
    sources,
    failures: [],
    imageFailures: [],
    failureCount: 0,
  };
}

function normalizeProjectionSort(raw = {}) {
  return {
    mode: cleanText(raw?.mode, RECOMMENDED_GALLERY_SORT.mode),
    label: cleanText(raw?.label, RECOMMENDED_GALLERY_SORT.label),
    signals: uniqueStrings(
      asArray(raw?.signals).length
        ? asArray(raw?.signals)
        : [...RECOMMENDED_GALLERY_SORT.signals],
    ),
  };
}

export function buildPrototypeGalleryReadModel({
  character,
  projection,
  preferences = DEFAULT_PREFERENCES,
}) {
  if (!character?.slug || !character?.displayName) {
    throw new Error(
      "Canonical Gallery model requires a Character slug and display name.",
    );
  }
  if (!projection || !Array.isArray(projection.prototypes)) {
    throw new Error("Canonical Gallery model requires a Prototype projection.");
  }
  const prototypeIds = projection.prototypes
    .map((prototype) =>
      cleanText(
        prototype?.prototypeId || prototype?.id || prototype?.projectionKey,
      ),
    )
    .filter(Boolean);
  const prototypeAliases = normalizeGalleryPrototypeAliases(
    projection.prototypeAliases,
    prototypeIds,
  );
  const normalizedPreferences = canonicalizeGalleryPrototypePreferences(
    preferences,
    prototypeAliases,
  );
  const prototypes = projection.prototypes
    .map((prototype) =>
      normalizeProjectionPrototype(prototype, normalizedPreferences),
    )
    .filter(Boolean)
    .sort(compareGalleryRecommendation);
  const providedSummary =
    projection.summary && typeof projection.summary === "object"
      ? projection.summary
      : {};
  const imageCount = prototypes.reduce(
    (total, prototype) => total + prototype.images.length,
    0,
  );
  const prototypeWithImageCount = prototypes.filter(
    (prototype) => prototype.coverImage,
  ).length;
  const catalogItemCount =
    Number(
      providedSummary.catalogItemCount ??
        projection.sourceCatalogItemCount ??
        projection.catalogItemCount,
    ) ||
    prototypes.reduce(
      (total, prototype) => total + prototype.catalogItems.length,
      0,
    );
  const projectionEligibleCount =
    Number(
      providedSummary.projectionEligibleCount ??
        projection.projectionEligibleItemCount ??
        projection.projectionEligibleCount,
    ) || catalogItemCount;
  return {
    viewMode: "prototype_projection",
    query: character.displayName,
    characterId: cleanText(character.characterId || character.characterKey),
    character: {
      characterId: cleanText(character.characterId || character.characterKey),
      slug: character.slug,
      displayName: character.displayName,
      aliases: uniqueStrings(asArray(character.aliases)),
      workNames: uniqueStrings(asArray(character.workNames)),
    },
    querySlug: character.slug,
    characterSlug: character.slug,
    products: prototypes,
    prototypes,
    prototypeAliases,
    sort: normalizeProjectionSort(projection.sort),
    summary: {
      ...providedSummary,
      products: prototypes.length,
      prototypes: prototypes.length,
      prototypeCount: prototypes.length,
      catalogItemCount,
      projectionEligibleCount,
      imageCount,
      prototypeWithImageCount,
    },
    preferences: normalizedPreferences,
  };
}

export function galleryReferenceProducts(products = []) {
  return products.filter((product) =>
    GALLERY_CLASSIFICATIONS.includes(product.classification),
  );
}

export function normalizeGallerySearch(value) {
  return cleanText(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function gallerySearchText(product) {
  return [
    product.title,
    product.manufacturer,
    ...asArray(product.manufacturers),
    ...asArray(product.catalogItems).flatMap((item) => [
      item.title,
      item.manufacturer,
    ]),
  ]
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
}

export function filterGalleryProducts(products = [], options = {}) {
  const search = normalizeGallerySearch(options.search);
  const classification = cleanText(options.classification, "all");
  const manufacturer = cleanText(options.manufacturer, "all");
  const design = cleanText(options.design, "all");
  const scale = cleanText(options.scale, "all");
  return galleryReferenceProducts(products).filter((product) => {
    if (!options.showExcluded && product.excluded) return false;
    if (classification !== "all" && product.classification !== classification)
      return false;
    if (
      manufacturer !== "all" &&
      ![product.manufacturer, ...asArray(product.manufacturers)].includes(
        manufacturer,
      )
    )
      return false;
    if (
      options.includeLegacyFilters &&
      design !== "all" &&
      product.design !== design
    )
      return false;
    if (
      options.includeLegacyFilters &&
      scale !== "all" &&
      product.scale !== scale
    )
      return false;
    return !search || gallerySearchText(product).includes(search);
  });
}

export function galleryManufacturerOptions(products = []) {
  return uniqueStrings(
    galleryReferenceProducts(products).flatMap((product) =>
      asArray(product.manufacturers).length
        ? product.manufacturers
        : [product.manufacturer],
    ),
  ).sort(compareText);
}

export function galleryTypeOptions(products = []) {
  return uniqueStrings(
    galleryReferenceProducts(products).map((product) => product.classification),
  ).sort(compareText);
}

function canonicalSource(source) {
  return {
    label: cleanText(source?.label),
    sourceFamily: normalizeGallerySourceFamily(source?.sourceFamily),
    url: cleanText(source?.url),
  };
}

function canonicalCatalogItem(item) {
  return {
    category: cleanText(item?.category, "unknown"),
    classification: cleanText(item?.classification, "unknown"),
    id: cleanText(item?.id),
    manufacturer: cleanText(item?.manufacturer, "unknown"),
    release: cleanText(item?.release),
    scale: cleanText(item?.scale, "unknown"),
    sources: asArray(item?.sources)
      .map(canonicalSource)
      .sort(
        (left, right) =>
          compareText(left.url, right.url) ||
          compareText(left.sourceFamily, right.sourceFamily),
      ),
    title: cleanText(item?.title),
  };
}

function canonicalImage(image) {
  return {
    catalogItemId: cleanText(image?.catalogItemId),
    excluded: image?.excluded === true,
    id: cleanText(image?.id),
    isMain: image?.isMain === true,
    sha256: cleanText(image?.sha256),
    sourceFamily: normalizeGallerySourceFamily(image?.sourceFamily),
    url: cleanText(image?.url || image?.sourceUrl),
  };
}

function canonicalCover(image) {
  return image ? canonicalImage(image) : null;
}

function canonicalPrototype(product) {
  return {
    catalogItemIds: uniqueStrings(asArray(product?.catalogItemIds)).sort(
      compareText,
    ),
    catalogItems: asArray(product?.catalogItems)
      .map(canonicalCatalogItem)
      .sort((left, right) => compareText(left.id, right.id)),
    category: cleanText(product?.category, "unknown"),
    classification: cleanText(product?.classification, "unknown"),
    coverImage: canonicalCover(product?.coverImage),
    coverSelectionSource: cleanText(product?.coverSelectionSource),
    excluded: product?.excluded === true,
    groupedCatalogItemCount: Number(product?.groupedCatalogItemCount) || 0,
    id: cleanText(product?.id || product?.prototypeId),
    images: asArray(product?.images)
      .map(canonicalImage)
      .sort((left, right) => compareText(left.id, right.id)),
    manufacturer: cleanText(product?.manufacturer, "unknown"),
    manufacturers: uniqueStrings(asArray(product?.manufacturers)).sort(
      compareText,
    ),
    membershipFingerprint: cleanText(product?.membershipFingerprint),
    note: cleanText(product?.note),
    preferredCoverUnavailable: product?.preferredCoverUnavailable === true,
    scale: cleanText(product?.scale, "unknown"),
    sources: asArray(product?.sources)
      .map(canonicalSource)
      .sort(
        (left, right) =>
          compareText(left.url, right.url) ||
          compareText(left.sourceFamily, right.sourceFamily),
      ),
    title: cleanText(product?.title),
  };
}

function parityValue(value) {
  return JSON.stringify(value);
}

function addParityMismatch(
  mismatches,
  character,
  prototypeId,
  scope,
  field,
  localValue,
  formalValue,
) {
  if (parityValue(localValue) === parityValue(formalValue)) return;
  mismatches.push({
    character,
    prototypeId,
    scope,
    field,
    localValue,
    formalValue,
  });
}

function usefulTitleTokens(products) {
  const candidates = [];
  for (const product of products) {
    for (const value of [
      product.title,
      ...asArray(product.catalogItems).map((item) => item.title),
    ]) {
      const tokens =
        String(value || "")
          .normalize("NFKC")
          .match(/[\p{L}\p{N}][\p{L}\p{N}!'’:.-]{2,}/gu) || [];
      const token = tokens.find((entry) => entry.length >= 4);
      if (token) candidates.push(token);
    }
  }
  if (candidates.length === 0) return [];
  return uniqueStrings([
    candidates[0],
    candidates[Math.floor(candidates.length / 2)],
    candidates[candidates.length - 1],
  ]);
}

export function buildGalleryParityQueries(model) {
  const products = asArray(model?.products);
  return uniqueStrings([
    model?.character?.displayName,
    ...asArray(model?.character?.aliases).slice(0, 2),
    ...usefulTitleTokens(products),
    ...galleryManufacturerOptions(products).slice(0, 2),
  ]);
}

export function compareGalleryReadModels(
  localModel,
  formalModel,
  options = {},
) {
  const character = cleanText(
    localModel?.characterSlug || formalModel?.characterSlug,
    "unknown",
  );
  const localProducts = asArray(localModel?.products);
  const formalProducts = asArray(formalModel?.products);
  const mismatches = [];
  addParityMismatch(
    mismatches,
    character,
    null,
    "summary",
    "prototypeCount",
    localProducts.length,
    formalProducts.length,
  );
  addParityMismatch(
    mismatches,
    character,
    null,
    "summary",
    "projectionEligibleCount",
    Number(localModel?.summary?.projectionEligibleCount) || 0,
    Number(formalModel?.summary?.projectionEligibleCount) || 0,
  );
  addParityMismatch(
    mismatches,
    character,
    null,
    "summary",
    "imageCount",
    Number(localModel?.summary?.imageCount) || 0,
    Number(formalModel?.summary?.imageCount) || 0,
  );
  addParityMismatch(
    mismatches,
    character,
    null,
    "card-order",
    "prototypeIds",
    localProducts.map((product) => product.id),
    formalProducts.map((product) => product.id),
  );

  const localById = new Map(
    localProducts.map((product) => [product.id, canonicalPrototype(product)]),
  );
  const formalById = new Map(
    formalProducts.map((product) => [product.id, canonicalPrototype(product)]),
  );
  for (const prototypeId of uniqueStrings([
    ...localById.keys(),
    ...formalById.keys(),
  ]).sort(compareText)) {
    addParityMismatch(
      mismatches,
      character,
      prototypeId,
      "prototype",
      "card-and-detail",
      localById.get(prototypeId) ?? null,
      formalById.get(prototypeId) ?? null,
    );
  }

  const queries = uniqueStrings(
    asArray(options.queries).length
      ? asArray(options.queries)
      : buildGalleryParityQueries(localModel),
  );
  for (const query of queries) {
    addParityMismatch(
      mismatches,
      character,
      null,
      "search",
      query,
      filterGalleryProducts(localProducts, { search: query }).map(
        (product) => product.id,
      ),
      filterGalleryProducts(formalProducts, { search: query }).map(
        (product) => product.id,
      ),
    );
  }

  const manufacturers = uniqueStrings([
    ...galleryManufacturerOptions(localProducts),
    ...galleryManufacturerOptions(formalProducts),
  ]).sort(compareText);
  for (const manufacturer of manufacturers) {
    addParityMismatch(
      mismatches,
      character,
      null,
      "manufacturer-filter",
      manufacturer,
      filterGalleryProducts(localProducts, { manufacturer }).map(
        (product) => product.id,
      ),
      filterGalleryProducts(formalProducts, { manufacturer }).map(
        (product) => product.id,
      ),
    );
  }

  const types = uniqueStrings([
    ...galleryTypeOptions(localProducts),
    ...galleryTypeOptions(formalProducts),
  ]).sort(compareText);
  for (const classification of types) {
    addParityMismatch(
      mismatches,
      character,
      null,
      "type-filter",
      classification,
      filterGalleryProducts(localProducts, { classification }).map(
        (product) => product.id,
      ),
      filterGalleryProducts(formalProducts, { classification }).map(
        (product) => product.id,
      ),
    );
  }

  const byScope = Object.fromEntries(
    [
      "summary",
      "card-order",
      "prototype",
      "search",
      "manufacturer-filter",
      "type-filter",
    ].map((scope) => [
      scope,
      mismatches.filter((mismatch) => mismatch.scope === scope).length,
    ]),
  );
  return {
    character,
    matched: mismatches.length === 0,
    mismatches,
    mismatchCount: mismatches.length,
    mismatchCountsByScope: byScope,
    querySet: queries,
    manufacturerSet: manufacturers,
    typeSet: types,
  };
}
