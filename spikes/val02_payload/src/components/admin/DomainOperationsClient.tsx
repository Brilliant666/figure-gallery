'use client'

import { useState } from 'react'

const endpoint = '/api/operation-logs/domain-action'
const actions = [
  'maintain-record',
  'open-review',
  'reopen-review',
  'complete-review',
  'revoke-client',
  'merge',
  'split',
  'undo-operation',
  'update-settings',
] as const

export function DomainOperationsClient() {
  const [action, setAction] = useState<(typeof actions)[number]>('maintain-record')
  const [parameters, setParameters] = useState('{}')
  const [reason, setReason] = useState('VAL-02B audited administrator command')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setMessage('')
    try {
      const parsed = JSON.parse(parameters) as Record<string, unknown>
      const response = await fetch(endpoint, {
        body: JSON.stringify({ ...parsed, action, reason }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Domain command failed.')
      setMessage('Domain command committed with an OperationLog entry.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Domain command failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Audited command form" data-testid="audited-command-form">
      <label>
        Command
        <select aria-label="Domain command" onChange={(event) => setAction(event.target.value as typeof action)} value={action}>
          {actions.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label>
        Parameters JSON
        <textarea aria-label="Domain command parameters" onChange={(event) => setParameters(event.target.value)} rows={8} value={parameters} />
      </label>
      <label>
        Audit reason
        <input aria-label="Domain command reason" onChange={(event) => setReason(event.target.value)} value={reason} />
      </label>
      <button disabled={busy || !reason.trim()} onClick={submit} type="button">Run audited command</button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}
