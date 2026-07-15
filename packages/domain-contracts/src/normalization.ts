import type { FigureVersionKind } from './enums'

export const CATALOG_NORMALIZATION_VERSION = 1 as const

/** Version 1 performs no translation or script conversion. */
export function normalizeCatalogName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\p{Script=Latin}/gu, (character) => character.toLowerCase())
}

export function uniqueNormalizedValues(values: Array<null | string | undefined>): string[] {
  return [...new Set(values.map((value) => (value ? normalizeCatalogName(value) : '')).filter(Boolean))]
}

export function buildCharacterSearchDocument(input: {
  aliases?: string[]
  displayName: string
  nameEn?: null | string
  nameJa?: null | string
  nameZh?: null | string
  workName?: null | string
}): string {
  return uniqueNormalizedValues([
    input.displayName,
    input.nameZh,
    input.nameJa,
    input.nameEn,
    ...(input.aliases ?? []),
    input.workName,
  ]).join(' ')
}

export function buildNormalizedVersionKey(input: {
  channelOrDistributorLabel?: null | string
  kind: FigureVersionKind
  name: string
}): string {
  return [
    input.kind,
    normalizeCatalogName(input.name),
    normalizeCatalogName(input.channelOrDistributorLabel ?? ''),
  ].join(':')
}
