import path from 'node:path'
import { collectSolaris } from './connectors/solaris.js'
import { collectGoodSmile } from './connectors/goodsmile.js'
import { collectJapanFigure, JapanFigurePaginationError } from './connectors/japan-figure.js'
import { mergeCatalog, groupingInputItem } from './catalog.js'
import { looksLikeFigure, poseExclusionReason } from './pose-eligibility.js'
import { matchesProfileRecord } from './profiles.js'
import { AccessBlockedError } from './network-policy.js'
import { characterRuntime, readJson, writeJsonAtomic } from './runtime.js'
import { buildProjectionInput, buildReviewTemplate, produceGrouping } from './grouping.js'

function countsBy(items, key) {
  return Object.fromEntries([...new Set(items.map(key))].sort().map((value) => [value, items.filter((item) => key(item) === value).length]))
}

async function optional(sourceName, operation, warnings) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AccessBlockedError) throw error
    if (error instanceof JapanFigurePaginationError) throw error
    warnings.push({ source: sourceName, error: error.message, ...(error.code ? { code: error.code } : {}) })
    return { source: sourceName, raw: 0, records: [] }
  }
}

export async function runPipeline({ mode, profile, fetcher, now = new Date().toISOString() }) {
  if (!['sync', 'refresh'].includes(mode)) throw new Error('Mode must be sync or refresh.')
  const warnings = []
  const runtime = characterRuntime(profile)
  const existing = await readJson(path.join(runtime, 'catalog-wide.json'), [])
  const results = []
  results.push(await optional('goodsmile', () => collectGoodSmile(fetcher, profile, { includeLegacy: mode === 'sync' }), warnings))
  results.push(await collectSolaris(fetcher, profile))
  results.push(await optional('japan-figure', () => collectJapanFigure(fetcher, profile), warnings))

  const filteredBySource = results.map((result) => {
    const matched = result.records.filter((item) => matchesProfileRecord(item, profile))
    const figureLike = matched.filter(looksLikeFigure).map((item) => ({
      ...item,
      sourcePoseExclusion: poseExclusionReason(item),
    }))
    return { ...result, matched: matched.length, eligibleBroad: figureLike.length, records: figureLike }
  })
  const incoming = filteredBySource.flatMap((result) => result.records)
  const merged = mergeCatalog(existing, incoming, now)
  const wide = merged.items.map((item) => {
    const reason = poseExclusionReason(item)
    return { ...item, poseEligibility: { eligible: !reason, exclusionReason: reason } }
  })
  const exclusions = wide.map((item) => ({ item, reason: item.poseEligibility.exclusionReason }))
  const poseEligible = exclusions.filter((entry) => !entry.reason).map((entry) => entry.item)
  const excludedCounts = countsBy(exclusions.filter((entry) => entry.reason), (entry) => entry.reason)
  const groupingInput = {
    schemaVersion: 1,
    character: { characterId: profile.characterId, slug: profile.slug, displayName: profile.displayName },
    generatedAt: now,
    catalogItemCount: poseEligible.length,
    catalogItems: poseEligible.map(groupingInputItem),
  }
  const groupingResults = produceGrouping(poseEligible, profile)
  const reviewTemplate = buildReviewTemplate(groupingResults, poseEligible)
  const projectionInput = buildProjectionInput(profile, poseEligible)
  const baselineComparisonInput = {
    schemaVersion: 1,
    character: profile.slug,
    count: poseEligible.length,
    items: poseEligible.map((item) => {
      const grouping = groupingInputItem(item)
      return {
        catalogItemId: item.catalogItemId,
        title: item.title,
        manufacturer: item.manufacturer,
        scale: item.scale,
        comparisonKey: grouping.comparisonKey,
        sourceIdentities: grouping.sourceIdentities,
        sourceUrls: item.sourceRefs.map((source) => source.url),
      }
    }),
  }
  const runId = now.replace(/[:.]/gu, '-').replace(/Z$/u, 'Z')
  const sourceStats = Object.fromEntries(filteredBySource.map((result) => [result.source, {
    raw: result.raw,
    characterMatched: result.matched,
    figureLike: result.eligibleBroad,
    ...(result.pagination ? { pagination: result.pagination } : {}),
  }]))
  const sourceStatuses = filteredBySource.map((result) => result.status).filter(Boolean)
  const summary = {
    schemaVersion: 1,
    runId,
    mode,
    character: profile.slug,
    status: sourceStatuses.includes('ERROR') ? 'error'
      : sourceStatuses.includes('INCOMPLETE') ? 'incomplete'
        : warnings.length ? 'pass_with_warnings' : 'pass',
    sourceStats,
    wideCatalog: wide.length,
    poseEligible: poseEligible.length,
    excluded: wide.length - poseEligible.length,
    exclusionReasons: excludedCounts,
    changes: merged.changes,
    grouping: groupingResults.counts,
    requestCount: fetcher.requestCount,
    warnings,
  }

  await writeJsonAtomic(path.join(runtime, 'catalog-wide.json'), wide)
  await writeJsonAtomic(path.join(runtime, 'catalog-pose-eligible.json'), poseEligible)
  await writeJsonAtomic(path.join(runtime, 'grouping-input.json'), groupingInput)
  await writeJsonAtomic(path.join(runtime, 'grouping-results.json'), groupingResults)
  await writeJsonAtomic(path.join(runtime, 'review-template.json'), reviewTemplate)
  await writeJsonAtomic(path.join(runtime, 'projection-input.json'), projectionInput)
  await writeJsonAtomic(path.join(runtime, 'baseline-comparison-input.json'), baselineComparisonInput)
  await writeJsonAtomic(path.join(runtime, 'state.json'), { schemaVersion: 1, character: profile.slug, lastRun: summary })
  await writeJsonAtomic(path.join(runtime, 'runs', runId, 'summary.json'), summary)
  return { runtime, summary, wide, poseEligible, groupingInput, groupingResults, reviewTemplate, projectionInput, baselineComparisonInput }
}
