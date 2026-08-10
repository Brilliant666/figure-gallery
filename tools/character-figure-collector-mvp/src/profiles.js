import { clean, containsTerm, normalized, unique } from './text.js'

const PROFILE_VALUES = [
  {
    slug: 'rem',
    characterId: 'rezero:rem',
    displayName: '蕾姆',
    aliases: ['Rem', 'レム', '蕾姆', '雷姆'],
    seriesAliases: ['Re:Zero', 'Re:ZERO', 'Re Zero', 'Re:ゼロから始める異世界生活', '从零开始的异世界生活'],
    conflictingAliases: [],
    poseExcludedAliases: [],
    titleStopwords: [],
    solarisCollectionHandles: ['rem-re-zero'],
    legacyQuery: 'Rem Re:ZERO',
    japanFigureQuery: 'Rem Re:ZERO figure',
    goodSmileSeeds: [
      'https://www.goodsmile.com/en/product/3992/Rem',
      'https://www.goodsmile.com/en/product/1136861',
      'https://www.goodsmile.com/en/product/1138196/Rem%2BBreather%2Bin%2Bthe%2BGarden%2BVer',
      'https://www.goodsmile.com/en/product/56932/POP%2BUP%2BPARADE%2BRem%2BL%2BSize',
      'https://www.goodsmile.com/en/product/9978/Another%2BWorld%2BRem',
      'https://www.goodsmile.com/en/product/4067/Rem%2BWedding%2BVer.',
      'https://www.goodsmile.com/en/product/1137281/Rem%2BBare%2BLeg%2BBunny%2BVer.%2B2nd',
    ],
  },
  {
    slug: 'cheshire',
    characterId: 'azur-lane:cheshire',
    displayName: '柴郡',
    aliases: ['Cheshire', 'チェシャー', '柴郡'],
    seriesAliases: ['Azur Lane', 'アズールレーン', '碧蓝航线', '碧藍航線'],
    conflictingAliases: ['Cheshire Cat', 'Alice in Wonderland'],
    poseExcludedAliases: ['Little Cheshire', 'リトルチェシャー', '小柴郡'],
    titleStopwords: ['Manjuu', 'Yostar', 'LIMEPIE'],
    solarisCollectionHandles: ['azur-lane-figures'],
    legacyQuery: 'Cheshire Azur Lane',
    japanFigureQuery: 'Cheshire Azur Lane figure',
    goodSmileSeeds: [
      'https://www.goodsmile.com/en/product/1136142/Cheshire+The+Cat+in+the+Magic+Hat',
      'https://www.goodsmile.com/en/product/36232/Cheshire%2BSummery%2BDate%2B',
      'https://www.goodsmile.com/en/product/36234/Cheshire%2BCait%2BSith%2BCrooner',
    ],
  },
]

export function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Character profile must be an object.')
  const slug = normalized(value.slug)
  const characterId = normalized(value.characterId)
  const displayName = clean(value.displayName)
  const aliases = unique([displayName, ...(value.aliases ?? [])])
  const seriesAliases = unique(value.seriesAliases)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(slug)) throw new Error('Profile slug must be lowercase ASCII.')
  if (!/^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(characterId)) throw new Error('Profile characterId is invalid.')
  if (!displayName || !aliases.length || !seriesAliases.length) throw new Error('Profile displayName, aliases, and seriesAliases are required.')
  const solarisCollectionHandles = unique(value.solarisCollectionHandles)
  if (solarisCollectionHandles.some((item) => !/^[a-z0-9][a-z0-9-]*$/u.test(item))) throw new Error('Solaris collection handles must be reviewed slugs.')
  const goodSmileSeeds = unique(value.goodSmileSeeds)
  if (goodSmileSeeds.some((url) => !/^https:\/\/(?:www\.)?goodsmile\.(?:com|info)\//u.test(url))) throw new Error('Good Smile seeds must use reviewed Good Smile URLs.')
  return Object.freeze({
    schemaVersion: 1,
    slug,
    characterId,
    displayName,
    aliases: Object.freeze(aliases),
    seriesAliases: Object.freeze(seriesAliases),
    conflictingAliases: Object.freeze(unique(value.conflictingAliases)),
    poseExcludedAliases: Object.freeze(unique(value.poseExcludedAliases)),
    titleStopwords: Object.freeze(unique(value.titleStopwords)),
    solarisCollectionHandles: Object.freeze(solarisCollectionHandles),
    legacyQuery: clean(value.legacyQuery),
    japanFigureQuery: clean(value.japanFigureQuery),
    goodSmileSeeds: Object.freeze(goodSmileSeeds),
  })
}

export const CHARACTER_PROFILES = Object.freeze(PROFILE_VALUES.map(validateProfile))

export function resolveProfile(value) {
  const wanted = normalized(value)
  return CHARACTER_PROFILES.find((profile) => profile.slug === wanted || profile.aliases.some((alias) => normalized(alias) === wanted)) ?? null
}

export function matchesCharacter(value, profile) {
  return validateProfile(profile).aliases.some((alias) => containsTerm(value, alias))
}

export function matchesSeries(value, profile) {
  return validateProfile(profile).seriesAliases.some((alias) => containsTerm(value, alias))
}

export function conflictingAlias(value, profile) {
  return validateProfile(profile).conflictingAliases.find((alias) => containsTerm(value, alias)) ?? null
}

export function matchesProfileRecord(record, profile) {
  const checked = validateProfile(profile)
  const title = clean(record.title)
  const corpus = clean([title, record.series, record.description, ...(record.tags ?? [])].join(' '))
  if (!matchesCharacter(corpus, checked) || !matchesSeries(corpus, checked)) return false
  return !conflictingAlias(title, checked)
}
