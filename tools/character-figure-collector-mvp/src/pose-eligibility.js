import { clean, normalized } from './text.js'

export const POSE_EXCLUSION_REASONS = Object.freeze([
  'Nendoroid',
  'Action/Figma',
  'Doll',
  'Plastic Model',
  'Deformed/Q',
  'Bust',
  'Merch',
])

export function looksLikeFigure(record) {
  const title = normalized(record.title)
  const category = normalized(record.category)
  const description = normalized(record.description)
  const tags = (record.tags ?? []).map(normalized).join(' ')
  const corpus = `${title} ${category} ${description} ${tags}`
  if (/(?:clear file|key\s*chain|keychain|rubber strap|acrylic stand|outfit set|plush|tapestry|pillow|cushion)/u.test(title)) return false
  if (normalized(record.productType) === 'figure' && !/plush|rubber mascot/u.test(corpus)) return true
  return /figure|figma|nendoroid|doll|plastic model|soft vinyl|pvc|abs|resin|scale|mm (?:in )?height/u.test(corpus)
}

export function poseExclusionReason(record) {
  if (record.profilePoseExclusion) return record.profilePoseExclusion
  if (record.sourcePoseExclusion) return record.sourcePoseExclusion
  const title = normalized(record.title)
  const category = normalized(record.category)
  const description = normalized(record.description)
  const tags = new Set((record.tags ?? []).map(normalized))
  const corpus = clean(`${title} ${category} ${description} ${[...tags].join(' ')}`).toLocaleLowerCase('en-US')

  if (corpus.includes('nendoroid')) return 'Nendoroid'
  if (category.includes('doll') || /pure\s*neemo|pureneemo|complete doll|harmonia|hybrid active figure/u.test(corpus)) return 'Doll'
  if (/plastic model|model kit/u.test(corpus)) return 'Plastic Model'
  if (
    ['action', 'figma'].includes(category) ||
    [...tags].some((tag) => ['action', 'figma', 'meta-type-action', 'meta-figure-action', 'meta-type-figma'].includes(tag)) ||
    /figma|figuarts mini|arctech|seamless action figure|action figure/u.test(`${title} ${category}`)
  ) return 'Action/Figma'
  if (/\bbust\b/u.test(`${title} ${category}`)) return 'Bust'
  if (/plush|key\s*chain|keychain|rubber strap|rubber mascot|acrylic stand|acrylic figure|clear file|outfit set|apparel|tapestry|cushion|pillow|towel/u.test(corpus)) return 'Merch'
  if (/deformed|chibi|pint-sized|happy\s*shake|happyshake|chouaiderukei|cu-?poche|cutie1|desktop army|dform|lulumecu|palverse|q posket|binivini baby|petanko|yurumari|otetsudai series|ippai collection|puchieete|hikkake|chokonokko|chibikyun|kyun-chara|chokorin mascot|look\s*up figure|miniature figure/u.test(corpus)) return 'Deformed/Q'
  return null
}

export function isPoseEligible(record) {
  return poseExclusionReason(record) === null
}
