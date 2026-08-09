const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const SAFE_CHARACTER_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/u

function uniqueText(values = []) {
  return [...new Set(values.map((value) => String(value || '').normalize('NFKC').trim()).filter(Boolean))]
}

export function normalizeCharacterLookup(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_]+/gu, ' ')
}

export function normalizeCharacterSlug(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!normalized) return null
  if (/^[a-z0-9-]+$/u.test(normalized)) return normalized.slice(0, 64).replace(/-+$/u, '')
  return null
}

const BUILTIN_CHARACTER_VALUES = [
  {
    schemaVersion: 1,
    characterId: 'azur-lane:cheshire',
    slug: 'cheshire',
    displayName: '柴郡',
    aliases: ['柴郡', 'Cheshire', 'チェシャー'],
    workNames: ['Azur Lane', 'アズールレーン', '碧蓝航线', '碧藍航線'],
    productTerms: ['figure', 'scale figure', 'フィギュア', 'スケールフィギュア', '手办', '比例手办'],
    discoveryQueries: [
      '"Azur Lane" Cheshire figure',
      '"Azur Lane" Cheshire scale figure',
      'アズールレーン チェシャー フィギュア',
      '碧蓝航线 柴郡 手办',
      '碧蓝航线 柴郡 比例手办',
    ],
    conflictingAliases: [],
    reviewedSeeds: [
      {
        url: 'https://www.goodsmile.com/en/product/36232/Cheshire%2BSummery%2BDate%2B',
        sourceType: 'official_manufacturer',
        reviewReason: 'Existing reviewed manufacturer product retained from MVP-02.',
        reviewedAt: '2026-07-23',
      },
      {
        url: 'https://www.goodsmile.com/en/product/36234/Cheshire%2BCait%2BSith%2BCrooner',
        sourceType: 'official_manufacturer',
        reviewReason: 'Existing reviewed manufacturer product retained from MVP-02.',
        reviewedAt: '2026-07-23',
      },
      {
        url: 'https://apex-toys.com/productinfo/3727461.html',
        sourceType: 'official_manufacturer',
        reviewReason: 'Existing reviewed manufacturer product retained from MVP-03A.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-181336',
        sourceType: 'retailer_seed_only',
        reviewReason: 'Existing individually reviewed distributor product retained from MVP-02.',
        reviewedAt: '2026-07-23',
      },
      {
        url: 'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-158150',
        sourceType: 'retailer_seed_only',
        reviewReason: 'Existing individually reviewed distributor product retained from MVP-02.',
        reviewedAt: '2026-07-23',
      },
    ],
  },
  {
    schemaVersion: 1,
    characterId: 'rezero:rem',
    slug: 'rem',
    displayName: '蕾姆',
    aliases: ['蕾姆', '雷姆', 'Rem', 'レム'],
    workNames: [
      'Re:Zero',
      'Re:ZERO',
      'Re:ゼロから始める異世界生活',
      '从零开始的异世界生活',
      'Re：从零开始的异世界生活',
    ],
    productTerms: ['figure', 'scale figure', 'PVC figure', 'フィギュア', 'スケールフィギュア', '手办', '比例手办'],
    conflictingAliases: ['Ram', 'ラム', '拉姆'],
    reviewedSeeds: [
      {
        url: 'https://www.goodsmile.com/en/product/3992/Rem',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem, Re:ZERO, scale, and manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/1136861',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Yukata Ver. and KADOKAWA manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/1138196/Rem%2BBreather%2Bin%2Bthe%2BGarden%2BVer',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Breather in the Garden Ver. and Good Smile Arts Shanghai.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/56932/POP%2BUP%2BPARADE%2BRem%2BL%2BSize',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for a static non-scale Rem complete figure.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/9978/Another%2BWorld%2BRem',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Another World Rem and Wonderful Works manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/4067/Rem%2BWedding%2BVer.',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Wedding Ver. and Phat! Company manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/1137281/Rem%2BBare%2BLeg%2BBunny%2BVer.%2B2nd',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Bare Leg Bunny Ver. 2nd and FREEing manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/1138279/%22Re%2BZERO%2B-Starting%2BLife%2Bin%2BAnother%2BWorld-%22%2BRem%2BCombat%2BOutfit%2BVer.',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Combat Outfit Ver. and KADOKAWA manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/1136857/Rem%2BPhantom%2BNight%2BWizard%2BVer.',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Phantom Night Wizard Ver. and KADOKAWA manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://www.goodsmile.com/en/product/59983/Rem%2BGraceful%2BBeauty%2B2024%2BNew%2BYear%2Bver.',
        sourceType: 'official_manufacturer',
        reviewReason: 'Good Smile official product page reviewed for Rem Graceful Beauty 2024 and KADOKAWA manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
      {
        url: 'https://alter-web.jp/products/622/',
        sourceType: 'official_manufacturer',
        reviewReason: 'ALTER official product page reviewed for Rem Nekomimi Ver., Re:Zero, scale, and manufacturer evidence.',
        reviewedAt: '2026-08-09',
      },
    ],
  },
]

export function validateCharacterConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Character config must be an object.')
  const displayName = String(input.displayName || '').normalize('NFKC').trim()
  const slug = normalizeCharacterSlug(input.slug)
  const characterId = String(input.characterId || '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
  const aliases = uniqueText([displayName, ...(input.aliases || [])])
  const workNames = uniqueText(input.workNames || [])
  const productTerms = uniqueText(input.productTerms || ['figure', 'フィギュア', '手办'])
  if (!displayName) throw new Error('Character displayName is required.')
  if (!slug || !SAFE_SLUG.test(slug)) throw new Error('Character slug must be a safe lowercase ASCII slug.')
  if (!SAFE_CHARACTER_ID.test(characterId)) throw new Error('Character characterId must be a stable lowercase identifier.')
  if (aliases.length === 0) throw new Error('Character aliases are required.')
  if (workNames.length === 0) throw new Error('Character workNames are required.')
  const reviewedSeeds = (input.reviewedSeeds || []).map((seed) => ({
    characterId,
    url: String(seed?.url || '').trim(),
    sourceType: String(seed?.sourceType || '').trim(),
    reviewReason: String(seed?.reviewReason || '').trim(),
    reviewedAt: String(seed?.reviewedAt || '').trim(),
  }))
  if ((input.reviewedSeeds || []).some((seed) => seed?.characterId && String(seed.characterId).toLocaleLowerCase('en-US') !== characterId)) {
    throw new Error('Every reviewed seed must belong to its character config.')
  }
  if (reviewedSeeds.some((seed) => !seed.url || !seed.sourceType || !seed.reviewReason || !/^\d{4}-\d{2}-\d{2}$/u.test(seed.reviewedAt))) {
    throw new Error('Every reviewed seed requires URL, sourceType, reviewReason, and YYYY-MM-DD reviewedAt.')
  }
  return Object.freeze({
    schemaVersion: 1,
    characterId,
    slug,
    displayName,
    aliases: Object.freeze(aliases),
    workNames: Object.freeze(workNames),
    productTerms: Object.freeze(productTerms),
    discoveryQueries: Object.freeze(uniqueText(input.discoveryQueries || [])),
    conflictingAliases: Object.freeze(uniqueText(input.conflictingAliases || [])),
    reviewedSeeds: Object.freeze(reviewedSeeds.map(Object.freeze)),
  })
}

export const BUILTIN_CHARACTERS = Object.freeze(BUILTIN_CHARACTER_VALUES.map(validateCharacterConfig))

export function resolveBuiltinCharacter(value) {
  const wanted = normalizeCharacterLookup(value)
  if (!wanted) return null
  return BUILTIN_CHARACTERS.find((character) =>
    normalizeCharacterLookup(character.slug) === wanted ||
    character.aliases.some((alias) => normalizeCharacterLookup(alias) === wanted),
  ) || null
}

export function buildCharacterDiscoveryQueries(character, { maxQueries = 30 } = {}) {
  const config = validateCharacterConfig(character)
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
    throw new Error('Discovery query limit must be from 1 through 30.')
  }
  if (config.discoveryQueries.length) return config.discoveryQueries.slice(0, maxQueries)
  const output = []
  const add = (value) => {
    const query = String(value || '').replace(/\s+/gu, ' ').trim()
    if (query && !output.includes(query) && output.length < maxQueries) output.push(query)
  }
  // Cover every configured dimension before filling the remaining bounded
  // matrix. This prevents the 30-query ceiling from starving later aliases
  // such as `Rem` or `レム` when a character has many work and product terms.
  config.aliases.forEach((alias, index) => {
    add(`${config.workNames[index % config.workNames.length]} ${alias} ${config.productTerms[index % config.productTerms.length]}`)
  })
  config.workNames.forEach((work, index) => {
    add(`${work} ${config.aliases[index % config.aliases.length]} ${config.productTerms[(index + config.aliases.length) % config.productTerms.length]}`)
  })
  config.productTerms.forEach((term, index) => {
    add(`${config.workNames[(index + config.aliases.length) % config.workNames.length]} ${config.aliases[(index + config.workNames.length) % config.aliases.length]} ${term}`)
  })
  for (const alias of config.aliases) {
    for (const work of config.workNames) {
      for (const term of config.productTerms) add(`${work} ${alias} ${term}`)
    }
  }
  return output
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function containsAlias(text, alias) {
  const source = String(text || '').normalize('NFKC')
  const target = String(alias || '').normalize('NFKC').trim()
  if (!target) return false
  if (/^[A-Za-z0-9][A-Za-z0-9 .:_+-]*$/u.test(target)) {
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped(target)}(?:$|[^A-Za-z0-9])`, 'iu').test(source)
  }
  return source.toLocaleLowerCase('en-US').includes(target.toLocaleLowerCase('en-US'))
}

export function matchesCharacterText(value, character) {
  return validateCharacterConfig(character).aliases.some((alias) => containsAlias(value, alias))
}

export function matchesCharacterWork(value, character) {
  return validateCharacterConfig(character).workNames.some((name) => containsAlias(value, name))
}

export function conflictingCharacterMatch(value, character) {
  return validateCharacterConfig(character).conflictingAliases.find((alias) => containsAlias(value, alias)) || null
}
