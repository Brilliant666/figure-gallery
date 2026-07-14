#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const usage = () => {
  throw new Error(
    'usage: node scripts/summarize-browser-results.mjs <playwright-results.json> <wagtail|payload>',
  )
}

const input = process.argv[2]
const prototype = process.argv[3]
if (!input || !['wagtail', 'payload'].includes(prototype)) usage()

const report = JSON.parse(fs.readFileSync(input, 'utf8'))

const specs = []
const visitSuite = (suite) => {
  for (const spec of suite.specs ?? []) specs.push(spec)
  for (const child of suite.suites ?? []) visitSuite(child)
}
for (const suite of report.suites ?? []) visitSuite(suite)

const decodeAttachment = (attachment) => {
  let bytes
  if (typeof attachment.body === 'string') bytes = Buffer.from(attachment.body, 'base64')
  else if (typeof attachment.path === 'string') bytes = fs.readFileSync(attachment.path)
  else return undefined
  return JSON.parse(bytes.toString('utf8'))
}

const findSpec = (prefix) => {
  const spec = specs.find((candidate) => candidate.title.startsWith(prefix))
  if (!spec) throw new Error(`missing Playwright spec: ${prefix}`)
  const test = (spec.tests ?? []).find((candidate) => candidate.projectName === `${prototype}-chrome`)
  if (!test) throw new Error(`missing ${prototype} result for: ${spec.title}`)
  const result = test.results?.at(-1)
  if (!result) throw new Error(`missing executed result for: ${spec.title}`)
  const attachments = Object.fromEntries(
    (result.attachments ?? []).map((attachment) => [attachment.name, decodeAttachment(attachment)]),
  )
  return { result, spec, test, attachments }
}

const statusFor = (result) => {
  if (result.status === 'passed') return 'pass'
  if (result.status === 'skipped') return 'not_run'
  return 'fail'
}

const compactError = (result) => {
  const value = result.error?.message ?? result.errors?.[0]?.message ?? 'browser assertion failed'
  return String(value).replaceAll(/\s+/g, ' ').slice(0, 240)
}

const assertion = (id, execution, extra = {}) => {
  const status = statusFor(execution.result)
  const metrics = execution.attachments['val02b-browser-metrics'] ?? {}
  const observations = execution.attachments['val02b-gallery-observations'] ?? {}
  const observed = status === 'pass'
    ? JSON.stringify({
        playwright_status: execution.result.status,
        duration_ms: execution.result.duration,
        clicks: metrics.clicks ?? 0,
        console_error_count: metrics.console_error_count ?? 0,
        forbidden_request_count: metrics.forbidden_request_count ?? 0,
        forbidden_request_hosts: metrics.forbidden_request_hosts ?? [],
        hpoi_request_attempt_count: metrics.hpoi_request_attempt_count ?? 0,
        keyboard_actions: metrics.keyboard_actions ?? 0,
        main_frame_navigations: metrics.main_frame_navigations ?? 0,
        network_failure_count: metrics.network_failure_count ?? 0,
        ...extra,
        ...(Object.keys(observations).length ? { gallery: observations } : {}),
      })
    : status === 'not_run'
      ? `Playwright skipped the gate: ${execution.test.annotations?.map((item) => item.description).filter(Boolean).join('; ') || 'runtime prerequisite absent'}`
      : compactError(execution.result)
  return {
    id,
    status,
    evidence: [{
      kind: status === 'not_run' ? 'blocker' : 'browser_test',
      reference: `spikes/val02b_infra/tests/browser-gates.spec.ts::${execution.spec.title}`,
      observed,
    }],
  }
}

const login = findSpec('BG-01 ')
const review = findSpec('BG-02 ')
const gallery = findSpec('BG-03/BG-04 ')
const assertions = [
  assertion('BG-01', login),
  assertion('BG-02', review),
  assertion('BG-03', gallery, { interaction: 'lightbox/zoom/previous/next/close' }),
  assertion('BG-04', gallery, { responsive_layout: 'computed 4/3/2 columns and contain geometry' }),
]

const metrics = Object.fromEntries([
  ['login', login],
  ['review', review],
  ['gallery', gallery],
].map(([name, execution]) => [name, {
  playwright_duration_ms: execution.result.duration,
  ...(execution.attachments['val02b-browser-metrics'] ?? {}),
}]))

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  prototype,
  source_report: path.basename(input),
  assertions,
  metrics,
}, null, 2)}\n`)
