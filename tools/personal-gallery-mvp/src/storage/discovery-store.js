import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { DISCOVERY_CANDIDATE_STATUSES } from '../discovery/hpoi-index.js'
import { validateCharacterConfig } from '../characters/registry.js'
import { ensureRuntimeMarker } from './runtime-root.js'
import { atomicWriteJson, readJson } from './json-files.js'

const TERMINAL_STATUSES = new Set(['already_collected', 'collected'])

function timestamp(clock) {
  return clock().toISOString()
}

function assertStatus(value) {
  if (!DISCOVERY_CANDIDATE_STATUSES.includes(value)) throw new Error(`Invalid discovery candidate status: ${value}`)
  return value
}

function uniqueEvidence(values = []) {
  const seen = new Set()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export class DiscoveryStore {
  constructor(root, { characterConfig, clock = () => new Date() } = {}) {
    if (!root) throw new Error('DiscoveryStore requires a runtime root.')
    this.root = path.resolve(root)
    this.character = validateCharacterConfig(characterConfig)
    this.clock = clock
    this.directory = path.join(this.root, 'discovery', this.character.slug)
    this.runsDirectory = path.join(this.directory, 'runs')
    this.candidatesPath = path.join(this.directory, 'candidates.json')
    this.coveragePath = path.join(this.directory, 'coverage.json')
  }

  async initialize() {
    await mkdir(this.runsDirectory, { recursive: true })
    await ensureRuntimeMarker(this.root)
    if ((await readJson(this.candidatesPath)) === null) {
      await atomicWriteJson(this.candidatesPath, {
        schemaVersion: 1,
        characterId: this.character.characterId,
        characterSlug: this.character.slug,
        updatedAt: null,
        candidates: [],
      })
    }
    return this
  }

  async loadCandidates() {
    await this.initialize()
    return readJson(this.candidatesPath, { candidates: [] })
  }

  async upsertCandidates(values = []) {
    const current = await this.loadCandidates()
    const byId = new Map((current.candidates || []).map((candidate) => [candidate.candidateId, candidate]))
    const observedAt = timestamp(this.clock)
    let created = 0
    let updated = 0
    for (const input of values) {
      if (!input?.candidateId || input.characterId !== this.character.characterId) throw new Error('Discovery candidate identity does not match the store character.')
      assertStatus(input.status)
      const existing = byId.get(input.candidateId)
      if (!existing) {
        byId.set(input.candidateId, {
          ...structuredClone(input),
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          lastStatusChangedAt: observedAt,
        })
        created += 1
        continue
      }
      const requestedStatus = TERMINAL_STATUSES.has(existing.status) ? existing.status : input.status
      const next = {
        ...existing,
        ...structuredClone(input),
        status: requestedStatus,
        firstSeenAt: existing.firstSeenAt,
        lastSeenAt: observedAt,
        lastStatusChangedAt: requestedStatus === existing.status ? existing.lastStatusChangedAt : observedAt,
        matchedProductId: input.matchedProductId || existing.matchedProductId || null,
        resolutionEvidence: uniqueEvidence([
          ...(existing.resolutionEvidence || []),
          ...(input.resolutionEvidence || []),
        ]),
      }
      if (JSON.stringify(next) !== JSON.stringify(existing)) updated += 1
      byId.set(input.candidateId, next)
    }
    const manifest = {
      schemaVersion: 1,
      characterId: this.character.characterId,
      characterSlug: this.character.slug,
      updatedAt: observedAt,
      candidates: [...byId.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    }
    await atomicWriteJson(this.candidatesPath, manifest)
    return { ...manifest, created, updated }
  }

  async updateCandidate(candidateId, mutate) {
    const current = await this.loadCandidates()
    const index = current.candidates.findIndex((candidate) => candidate.candidateId === candidateId)
    if (index < 0) throw new Error(`Unknown discovery candidate: ${candidateId}`)
    const previous = current.candidates[index]
    const next = mutate(structuredClone(previous)) || previous
    assertStatus(next.status)
    const now = timestamp(this.clock)
    next.firstSeenAt = previous.firstSeenAt
    next.lastSeenAt = previous.lastSeenAt
    next.lastStatusChangedAt = next.status === previous.status ? previous.lastStatusChangedAt : now
    next.resolutionEvidence = uniqueEvidence(next.resolutionEvidence || [])
    current.candidates[index] = next
    current.updatedAt = now
    await atomicWriteJson(this.candidatesPath, current)
    return next
  }

  async writeCoverage(value) {
    const coverage = {
      schemaVersion: 1,
      characterId: this.character.characterId,
      characterSlug: this.character.slug,
      updatedAt: timestamp(this.clock),
      ...structuredClone(value),
    }
    await atomicWriteJson(this.coveragePath, coverage)
    return coverage
  }

  async readCoverage() {
    return readJson(this.coveragePath)
  }

  async writeRun(runId, value) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) throw new Error('Discovery run ID is invalid.')
    const run = {
      schemaVersion: 1,
      runId,
      characterId: this.character.characterId,
      characterSlug: this.character.slug,
      ...structuredClone(value),
    }
    await atomicWriteJson(path.join(this.runsDirectory, `${runId}.json`), run)
    return run
  }

  async readView() {
    const manifest = await this.loadCandidates()
    return {
      character: {
        characterId: this.character.characterId,
        slug: this.character.slug,
        displayName: this.character.displayName,
      },
      coverage: await this.readCoverage(),
      candidates: manifest.candidates,
    }
  }
}

export async function createDiscoveryStore(root, options) {
  return new DiscoveryStore(root, options).initialize()
}
