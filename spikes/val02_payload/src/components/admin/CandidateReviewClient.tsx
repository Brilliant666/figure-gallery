'use client'

import { useMemo, useState } from 'react'

type ID = number | string
type Option = { disabled?: boolean; id: ID; label: string }

export type CandidateReviewItem = {
  id: ID
  images: { id: ID; isAdult: boolean; previewUrl: string; sourceUrl: string; storageKey: string }[]
  rawFields: Record<string, unknown>
  reason: string
  status: string
  targetPrototypeID: ID | null
}

export type ReviewWorkItemOption = {
  allowedTargetIDs: ID[]
  candidateID: ID
  id: ID
  lockVersion: number
  status: string
}

type Props = {
  candidates: CandidateReviewItem[]
  characters: Option[]
  manufacturers: Option[]
  prototypes: Option[]
  versions: (Option & { prototypeID: ID })[]
  workItems: ReviewWorkItemOption[]
}

const reviewEndpoint = '/api/candidate-records/review-action'
const acceptedPrototypeFields = new Set(['category', 'scale', 'title'])

export const findCandidateByID = (
  candidates: CandidateReviewItem[],
  id: ID | null,
): CandidateReviewItem | undefined =>
  candidates.find((candidate) => String(candidate.id) === String(id))

export function CandidateReviewClient({
  candidates,
  characters,
  manufacturers,
  prototypes,
  versions,
  workItems,
}: Props) {
  const [selectedCandidateID, setSelectedCandidateID] = useState<ID | null>(candidates[0]?.id ?? null)
  const selected = useMemo(
    () => findCandidateByID(candidates, selectedCandidateID),
    [candidates, selectedCandidateID],
  )
  const [targetPrototypeID, setTargetPrototypeID] = useState<ID | ''>(
    selected?.targetPrototypeID ?? '',
  )
  const [characterID, setCharacterID] = useState<ID | ''>(characters[0]?.id ?? '')
  const [versionID, setVersionID] = useState<ID | ''>('')
  const [manufacturerID, setManufacturerID] = useState<ID | ''>(
    manufacturers.find((item) => !item.disabled)?.id ?? '',
  )
  const [newManufacturerName, setNewManufacturerName] = useState('')
  const [reason, setReason] = useState('VAL-02 administrator review')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [workItemVersions, setWorkItemVersions] = useState<Record<string, number>>(
    () => Object.fromEntries(workItems.map((item) => [String(item.id), item.lockVersion])),
  )
  const workItem = workItems.find(
    (item) => item.status === 'open' && String(item.candidateID) === String(selected?.id),
  )
  const allowedPrototypeIDs = new Set((workItem?.allowedTargetIDs ?? []).map(String))
  const currentWorkItemVersion = workItem
    ? (workItemVersions[String(workItem.id)] ?? workItem.lockVersion)
    : null

  const selectCandidate = (id: ID) => {
    const next = findCandidateByID(candidates, id)
    setSelectedCandidateID(id)
    setTargetPrototypeID(next?.targetPrototypeID ?? '')
    setVersionID('')
  }

  const run = async (body: Record<string, unknown>) => {
    if (!workItem || currentWorkItemVersion === null) {
      setMessage('An open review work item is required for every review write.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(reviewEndpoint, {
        body: JSON.stringify({
          candidateID: selected?.id,
          expectedVersion: currentWorkItemVersion,
          reason,
          workItemID: workItem.id,
          ...body,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = (await response.json()) as {
        error?: string
        ok?: boolean
        workItemVersion?: number
      }
      if (!response.ok) throw new Error(result.error ?? 'Review action failed.')
      if (typeof result.workItemVersion === 'number') {
        setWorkItemVersions((current) => ({
          ...current,
          [String(workItem.id)]: result.workItemVersion!,
        }))
      }
      setMessage('Action recorded. Refresh to see persisted state.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review action failed.')
    } finally {
      setBusy(false)
    }
  }

  const completeWorkItem = async () => {
    if (!workItem || !selected || !targetPrototypeID) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/operation-logs/domain-action', {
        body: JSON.stringify({
          action: 'complete-review',
          candidateID: selected.id,
          expectedVersion: currentWorkItemVersion,
          reason,
          targetID: targetPrototypeID,
          workItemID: workItem.id,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Review work item completion failed.')
      setMessage('Review work item completed and audited.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review work item completion failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!selected) {
    return (
      <main style={{ margin: '2rem auto', maxWidth: 960 }}>
        <h1>Candidate review</h1>
        <p>No candidates are waiting.</p>
      </main>
    )
  }

  return (
    <main data-testid="candidate-review-workbench" style={{ margin: '2rem auto', maxWidth: 1100, padding: '0 1rem' }}>
      <h1>Candidate review workbench</h1>
      <p>All writes below use the administrator-only review endpoint and produce OperationLog rows.</p>

      <label>
        Candidate
        <select
          aria-label="Candidate"
          data-testid="candidate-select"
          onChange={(event) => selectCandidate(event.target.value)}
          value={String(selectedCandidateID)}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {String(candidate.rawFields.title)} — {candidate.status}
            </option>
          ))}
        </select>
      </label>

      <section aria-label="Candidate fields">
        <h2>Proposed fields</h2>
        <table data-testid="candidate-fields">
          <tbody>
            {Object.entries(selected.rawFields).map(([field, value]) => {
              const canAccept = acceptedPrototypeFields.has(field)
              return (
                <tr key={field}>
                  <th>{field}</th>
                  <td>{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</td>
                  <td>
                    <button
                      aria-label={`Accept ${field}`}
                      data-testid={`accept-${field}`}
                      disabled={busy || !canAccept}
                      onClick={() => run({ action: 'accept-field', field, value })}
                      title={canAccept ? 'Apply this field to the prototype' : 'Review-only field'}
                    >
                      Accept field
                    </button>{' '}
                    <button aria-label={`Reject ${field}`} data-testid={`reject-${field}`} disabled={busy} onClick={() => run({ action: 'reject-field', field, value })}>
                      Reject field
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section aria-label="Candidate images">
        <h2>Candidate images</h2>
        <ul data-testid="candidate-image-list">
          {selected.images.map((image) => (
            <li data-testid="candidate-image" key={image.id}>
              {image.previewUrl ? (
                // Local Payload media URL only; sourceUrl is never used as an image src.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`Candidate ${image.id}`}
                  src={image.previewUrl}
                  style={{ display: 'block', height: '160px', objectFit: 'contain', width: '220px' }}
                />
              ) : (
                <span>Preview pending local upload. </span>
              )}
              <code>{image.storageKey}</code> {image.isAdult ? '(adult)' : ''}{' '}
              <button
                aria-label={`Select image ${image.id} as main`}
                data-testid={`select-main-image-${image.id}`}
                disabled={busy || !targetPrototypeID}
                onClick={() =>
                  run({ action: 'select-main-image', mediaID: image.id, prototypeID: targetPrototypeID })
                }
              >
                Select as manual main image
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Formal target">
        <h2>Formal target</h2>
        <label>
          Existing prototype
          <select aria-label="Existing prototype" data-testid="target-prototype" onChange={(event) => setTargetPrototypeID(event.target.value)} value={targetPrototypeID}>
            <option value="">Select…</option>
            {prototypes.filter((prototype) => allowedPrototypeIDs.has(String(prototype.id))).map((prototype) => (
              <option key={prototype.id} value={prototype.id}>
                {prototype.label} (allowed)
              </option>
            ))}
          </select>
        </label>
        <label>
          New draft manufacturer
          <input
            onChange={(event) => setNewManufacturerName(event.target.value)}
            placeholder="Manufacturer name"
            value={newManufacturerName}
          />
        </label>
        <button
          data-testid="attach-version"
          disabled={busy || !newManufacturerName.trim()}
          onClick={() =>
            run({ action: 'create-manufacturer', newManufacturerName: newManufacturerName.trim() })
          }
        >
          Create draft manufacturer
        </button>
        <button
          disabled={busy || !targetPrototypeID || !versionID}
          onClick={() =>
            run({
              action: 'attach-version',
              prototypeID: targetPrototypeID,
              versionID,
            })
          }
        >
          Attach to existing version
        </button>
        <button
          data-testid="publish-formal-target"
          disabled={busy || !targetPrototypeID}
          onClick={() =>
            run({
              action: 'set-prototype-publication',
              prototypeID: targetPrototypeID,
              publicationStatus: 'published',
            })
          }
        >
          Publish formal target
        </button>
        <label>
          Existing version
          <select onChange={(event) => setVersionID(event.target.value)} value={versionID}>
            <option value="">Select…</option>
            {versions
              .filter((version) => String(version.prototypeID) === String(targetPrototypeID))
              .map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label}
                </option>
              ))}
          </select>
        </label>

        <h3>Create a draft prototype</h3>
        <label>
          Character
          <select onChange={(event) => setCharacterID(event.target.value)} value={characterID}>
            {characters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Active manufacturer
          <select onChange={(event) => setManufacturerID(event.target.value)} value={manufacturerID}>
            {manufacturers.map((item) => (
              <option disabled={item.disabled} key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !characterID || !manufacturerID}
          onClick={() =>
            run({
              action: 'create-prototype',
              newPrototype: {
                characters: [characterID],
                figureType: String(selected.rawFields.category).includes('景品') ? 'prize' : 'scale',
                manufacturer: manufacturerID,
                scale: selected.rawFields.scale,
                title: selected.rawFields.title,
              },
            })
          }
        >
          Create draft prototype
        </button>
      </section>

      <section aria-label="Disposition">
        <h2>Disposition</h2>
        <label>
          Audit reason
          <input aria-label="Audit reason" data-testid="audit-reason" onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        <button disabled={busy || !reason.trim()} onClick={() => run({ action: 'defer' })}>
          Defer
        </button>{' '}
        <button disabled={busy || !reason.trim()} onClick={() => run({ action: 'ignore' })}>
          Ignore
        </button>
        <button
          data-testid="complete-review-work-item"
          disabled={busy || !reason.trim() || !targetPrototypeID || !workItem || !allowedPrototypeIDs.has(String(targetPrototypeID))}
          onClick={completeWorkItem}
        >
          Complete review work item
        </button>
      </section>

      <p data-testid="review-work-item-state">
        {workItem ? `Work item ${workItem.id}, version ${currentWorkItemVersion}` : 'No open review work item'}
      </p>
      {message ? <p data-testid="review-status" role="status">{message}</p> : null}
    </main>
  )
}
