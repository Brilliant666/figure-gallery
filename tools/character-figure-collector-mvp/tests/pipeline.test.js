import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runPipeline } from '../src/pipeline.js'
import { resolveProfile } from '../src/profiles.js'
import { JapanFigurePaginationError } from '../src/connectors/japan-figure.js'

function goodSmileHtml(url) {
  const id = String(url).match(/\/product\/(\d+)/u)?.[1]
  const titles = {
    1136142: 'Cheshire The Cat in the Magic Hat',
    36232: 'Cheshire Summery Date',
    36234: 'Cheshire Cait Sith Crooner',
  }
  return `<h1 id="product-name">${titles[id]}</h1><dl><dt>Series</dt><dd>Azur Lane</dd><dt>Manufacturer</dt><dd>Good Smile Arts Shanghai</dd><dt>Category</dt><dd>Scale Figure</dd><dt>Specifications</dt><dd>1/7 scale. Approximately 250 mm in height.</dd></dl><img src="/product/image/${id}/01.jpg">`
}

function solarisProduct(id, title, { category = 'General' } = {}) {
  return {
    id,
    title,
    handle: `cheshire-${id}`,
    vendor: 'Good Smile Arts Shanghai, Good Smile Company',
    product_type: 'Figure',
    tags: [`meta-type-${category}`],
    body_html: '<p>1/7 scale, approximately 250 mm in height.</p>',
    images: [{ src: `https://cdn.example.test/${id}.jpg` }],
    variants: [{ available: true }],
  }
}

test('offline pipeline writes wide, eligible, grouping, review, and projection contracts idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-collector-test-'))
  const previousRoot = process.env.CHARACTER_FIGURE_COLLECTOR_ROOT
  process.env.CHARACTER_FIGURE_COLLECTOR_ROOT = root
  const fetcher = {
    requestCount: 0,
    async text(url) { this.requestCount += 1; return goodSmileHtml(url) },
    async json() {
      this.requestCount += 1
      return { products: [
        solarisProduct('magic', 'Azur Lane Cheshire The Cat in the Magic Hat 1/7 Complete Figure'),
        solarisProduct('summer', 'Azur Lane Cheshire Summery Date Ver. 1/7 Complete Figure'),
        solarisProduct('crooner', 'Azur Lane Cheshire Cait Sith Crooner Ver. 1/7 Complete Figure'),
        solarisProduct('little', 'Azur Lane Little Cheshire Figure'),
        solarisProduct('nendo', 'Azur Lane Cheshire Nendoroid', { category: 'Nendoroid' }),
      ] }
    },
    async postJson() {
      this.requestCount += 1
      return { result: { structuredContent: { products: [], pagination: { has_next_page: false, cursor: null } } } }
    },
  }
  try {
    const profile = resolveProfile('cheshire')
    const first = await runPipeline({ mode: 'refresh', profile, fetcher, now: '2026-08-10T00:00:00.000Z' })
    assert.equal(first.summary.sourceStats.solaris.raw, 5)
    assert.equal(first.summary.wideCatalog, 5)
    assert.equal(first.summary.poseEligible, 3)
    assert.equal(first.summary.sourceStats['japan-figure'].pagination.pagesFetched, 1)
    assert.equal(first.summary.sourceStats['japan-figure'].pagination.paginationExhausted, true)
    assert.equal(first.summary.exclusionReasons['Deformed/Q'], 1)
    assert.equal(first.summary.exclusionReasons.Nendoroid, 1)
    assert.equal(first.projectionInput.count, 3)
    assert.equal(first.baselineComparisonInput.count, 3)
    assert.ok(first.baselineComparisonInput.items.every((item) => item.comparisonKey && item.sourceUrls.length))
    assert.ok(Array.isArray(first.groupingResults.pairDecisions))
    assert.ok(Array.isArray(first.reviewTemplate.reviewPairs))
    assert.ok(first.wide.every((item) => item.poseEligibility && typeof item.poseEligibility.eligible === 'boolean'))

    const second = await runPipeline({ mode: 'refresh', profile, fetcher, now: '2026-08-10T00:10:00.000Z' })
    assert.equal(second.summary.changes.new, 0)
    assert.equal(second.summary.changes.changed, 0)
    assert.equal(second.summary.changes.unchanged, 5)
    const projection = JSON.parse(await readFile(path.join(root, 'cheshire', 'projection-input.json'), 'utf8'))
    const grouping = JSON.parse(await readFile(path.join(root, 'cheshire', 'grouping-results.json'), 'utf8'))
    assert.equal(projection.count, projection.items.length)
    assert.ok(grouping.pairDecisions.every((pair) => pair.pairId && pair.items.every((item) => item.id)))

    const invalidPaginationFetcher = {
      ...fetcher,
      requestCount: 0,
      async postJson() {
        this.requestCount += 1
        return { result: { structuredContent: { products: [], pagination: { has_next_page: true, cursor: null } } } }
      },
    }
    await assert.rejects(
      runPipeline({ mode: 'refresh', profile, fetcher: invalidPaginationFetcher, now: '2026-08-10T00:20:00.000Z' }),
      (error) => error instanceof JapanFigurePaginationError && error.code === 'protocol_error',
    )
  } finally {
    if (previousRoot === undefined) delete process.env.CHARACTER_FIGURE_COLLECTOR_ROOT
    else process.env.CHARACTER_FIGURE_COLLECTOR_ROOT = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
