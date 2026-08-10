import { clean, containsTerm, parseHeightMm, parseScale, unique } from './text.js'
import { manufacturerKey, semanticTitle, structuralVariantSignature } from './semantic-title.js'

export function record({
  sourceFamily,
  sourceId,
  sourceUrl,
  character,
  title,
  series = '',
  manufacturer = '',
  category = 'Figure',
  description = '',
  imageUrls = [],
  tags = [],
  productType = 'Figure',
  release = '',
  scale = null,
  heightMm = null,
  available = null,
  sourceUpdatedAt = null,
}) {
  const corpus = `${title} ${description}`
  const cleanedTitle = clean(title)
  const cleanedManufacturer = clean(manufacturer)
  return {
    schemaVersion: 1,
    characterId: character.characterId,
    characterSlug: character.slug,
    title: cleanedTitle,
    series: clean(series),
    manufacturer: cleanedManufacturer,
    category: clean(category) || 'Figure',
    description: clean(description).slice(0, 1600),
    scale: scale || parseScale(corpus),
    heightMm: heightMm || parseHeightMm(description),
    release: clean(release),
    productType: clean(productType) || 'Figure',
    tags: unique(tags),
    images: unique(imageUrls).map((url) => ({ url, sourceFamily })),
    sourceRefs: [{ family: sourceFamily, sourceId: clean(sourceId), url: clean(sourceUrl) }],
    available,
    sourceUpdatedAt,
    profilePoseExclusion: (character.poseExcludedAliases ?? []).some((alias) => containsTerm(title, alias)) ? 'Deformed/Q' : null,
    semanticTitle: semanticTitle(cleanedTitle, character, cleanedManufacturer),
    manufacturerKey: manufacturerKey(cleanedManufacturer),
    structuralVariantSignature: structuralVariantSignature(cleanedTitle),
  }
}
