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

type Props = {
  candidates: CandidateReviewItem[]
  characters: Option[]
  manufacturers: Option[]
  prototypes: Option[]
  versions: (Option & { prototypeID: ID })[]
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

  const selectCandidate = (id: ID) => {
    const next = findCandidateByID(candidates, id)
    setSelectedCandidateID(id)
    setTargetPrototypeID(next?.targetPrototypeID ?? '')
    setVersionID('')
  }

  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(reviewEndpoint, {
        body: JSON.stringify({ candidateID: selected?.id, reason, ...body }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = (await response.json()) as { error?: string; ok?: boolean }
      if (!response.ok) throw new Error(result.error ?? 'Review action failed.')
      setMessage('Action recorded. Refresh to see persisted state.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review action failed.')
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
    <main style={{ margin: '2rem auto', maxWidth: 1100, padding: '0 1rem' }}>
      <h1>Candidate review workbench</h1>
      <p>All writes below use the administrator-only review endpoint and produce OperationLog rows.</p>

      <label>
        Candidate
        <select
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
        <table>
          <tbody>
            {Object.entries(selected.rawFields).map(([field, value]) => {
              const canAccept = acceptedPrototypeFields.has(field)
              return (
                <tr key={field}>
                  <th>{field}</th>
                  <td>{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</td>
                  <td>
                    <button
                      disabled={busy || !canAccept}
                      onClick={() => run({ action: 'accept-field', field, value })}
                      title={canAccept ? 'Apply this field to the prototype' : 'Review-only field'}
                    >
                      Accept field
                    </button>{' '}
                    <button disabled={busy} onClick={() => run({ action: 'reject-field', field, value })}>
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
        <ul>
          {selected.images.map((image) => (
            <li key={image.id}>
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
          <select onChange={(event) => setTargetPrototypeID(event.target.value)} value={targetPrototypeID}>
            <option value="">Select…</option>
            {prototypes.map((prototype) => (
              <option key={prototype.id} value={prototype.id}>
                {prototype.label}
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
          <input onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        <button disabled={busy || !reason.trim()} onClick={() => run({ action: 'defer' })}>
          Defer
        </button>{' '}
        <button disabled={busy || !reason.trim()} onClick={() => run({ action: 'ignore' })}>
          Ignore
        </button>
      </section>

      {message ? <p role="status">{message}</p> : null}
    </main>
  )
}
