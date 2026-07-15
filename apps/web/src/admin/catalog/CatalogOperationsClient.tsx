'use client'

import {
  CHARACTER_ALIAS_TYPES,
  CHARACTER_STATUSES,
  FIGURE_RELEASE_STATUSES,
  FIGURE_TYPES,
  FIGURE_VERSION_KINDS,
  GRAY_MODEL_COMPLETENESS,
  MANUFACTURER_STATUSES,
  PROTOTYPE_CHARACTER_ROLES,
  PROTOTYPE_PUBLICATION_STATUSES,
  WORK_PUBLICATION_STATUSES,
  WORK_TYPES,
  type CatalogCommand,
  type CatalogCommandResult,
  type CharacterAliasType,
  type CharacterStatus,
  type FigureReleaseStatus,
  type FigureType,
  type FigureVersionKind,
  type GrayModelCompleteness,
  type ManufacturerStatus,
  type PrototypeCharacterRole,
  type PrototypeCharacterCommandInput,
  type PrototypePublicationStatus,
  type WorkPublicationStatus,
  type WorkType,
} from '@figure-gallery/domain-contracts'
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'

import styles from './catalog.module.css'

const CATALOG_COMMAND_ENDPOINT = '/api/admin/catalog/commands'
const AUTHORIZATION_REVIEW_STATUSES = ['official', 'authorized_third_party', 'rejected'] as const
const INCLUSION_REVIEW_STATUSES = ['eligible', 'excluded'] as const

type WithoutOperationId<T> = T extends unknown ? Omit<T, 'operationId'> : never
type CatalogCommandDraft = WithoutOperationId<CatalogCommand>

type CatalogCommandSuccess = {
  ok: true
  replayed: boolean
  result: CatalogCommandResult
}

type CatalogCommandFailure = {
  error: {
    code: string
    details?: unknown
    message: string
  }
  ok: false
}

type Feedback =
  | { kind: 'error'; code: string; details?: unknown; message: string }
  | { kind: 'success'; replayed: boolean; result: CatalogCommandResult }

type CatalogOperationsClientProps = {
  initialOperationId: string
}

type CommandFormProps = {
  buildCommand: (data: FormData) => CatalogCommandDraft
  children: ReactNode
  description?: string
  onCommand: (command: CatalogCommandDraft) => Promise<void>
  pending: boolean
  submitLabel: string
  testId: string
  title: string
}

type FieldProps = {
  children: ReactNode
  hint?: string
  id: string
  label: string
}

type VersionedFieldsProps = {
  prefix: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCatalogCommandResult(value: unknown): value is CatalogCommandResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.entityType === 'string' &&
    typeof value.lockVersion === 'number' &&
    typeof value.operationId === 'string' &&
    typeof value.stableId === 'string' &&
    (value.relatedStableId === undefined || typeof value.relatedStableId === 'string') &&
    (value.status === undefined || typeof value.status === 'string') &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) &&
        value.warnings.every(
          (warning) =>
            isRecord(warning) &&
            typeof warning.code === 'string' &&
            typeof warning.message === 'string',
        )))
  )
}

function isSuccessEnvelope(value: unknown): value is CatalogCommandSuccess {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.replayed === 'boolean' &&
    isCatalogCommandResult(value.result)
  )
}

function isFailureEnvelope(value: unknown): value is CatalogCommandFailure {
  return (
    isRecord(value) &&
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  )
}

function requiredText(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim()
}

function optionalText(data: FormData, name: string): string | undefined {
  const value = requiredText(data, name)
  return value.length > 0 ? value : undefined
}

function requiredChoice<T extends string>(data: FormData, name: string): T {
  return requiredText(data, name) as T
}

function optionalChoice<T extends string>(data: FormData, name: string): T | undefined {
  return optionalText(data, name) as T | undefined
}

function requiredInteger(data: FormData, name: string): number {
  return Number.parseInt(requiredText(data, name), 10)
}

function isChecked(data: FormData, name: string): boolean {
  return data.get(name) === 'on'
}

function versionedFields(data: FormData) {
  return {
    expectedVersion: requiredInteger(data, 'expectedVersion'),
    reason: requiredText(data, 'reason'),
    stableId: requiredText(data, 'stableId'),
  }
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDetails(details: unknown): string {
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

function Field({ children, hint, id, label }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}

function Options({ values }: { values: readonly string[] }) {
  return values.map((value) => (
    <option key={value} value={value}>
      {humanize(value)}
    </option>
  ))
}

function VersionedFields({ prefix }: VersionedFieldsProps) {
  return (
    <>
      <Field id={`${prefix}-stable-id`} label="Stable ID">
        <input
          data-testid={`${prefix}-stable-id`}
          id={`${prefix}-stable-id`}
          name="stableId"
          required
          type="text"
        />
      </Field>
      <Field id={`${prefix}-expected-version`} label="Expected lock version">
        <input
          data-testid={`${prefix}-expected-version`}
          id={`${prefix}-expected-version`}
          min="0"
          name="expectedVersion"
          required
          step="1"
          type="number"
        />
      </Field>
      <Field id={`${prefix}-reason`} label="Operation reason">
        <textarea
          data-testid={`${prefix}-reason`}
          id={`${prefix}-reason`}
          name="reason"
          required
          rows={3}
        />
      </Field>
    </>
  )
}

function CommandForm({
  buildCommand,
  children,
  description,
  onCommand,
  pending,
  submitLabel,
  testId,
  title,
}: CommandFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onCommand(buildCommand(new FormData(event.currentTarget)))
  }

  return (
    <form aria-busy={pending} className={styles.card} data-testid={testId} onSubmit={handleSubmit}>
      <h3>{title}</h3>
      {description ? <p className={styles.hint}>{description}</p> : null}
      <div className={styles.fields}>{children}</div>
      <button
        className={styles.submit}
        data-testid={`${testId}-submit`}
        disabled={pending}
        type="submit"
      >
        {pending ? 'Submitting…' : submitLabel}
      </button>
    </form>
  )
}

function FeedbackPanel({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) {
    return null
  }

  if (feedback.kind === 'error') {
    return (
      <section
        className={`${styles.feedback} ${styles.error}`}
        data-testid="catalog-command-error"
        role="alert"
      >
        <strong>Command failed</strong>
        <p>
          Error code: <code data-testid="catalog-command-error-code">{feedback.code}</code>
        </p>
        <p>{feedback.message}</p>
        {feedback.details === undefined ? null : (
          <pre className={styles.details} data-testid="catalog-command-error-details">
            {formatDetails(feedback.details)}
          </pre>
        )}
      </section>
    )
  }

  const { result } = feedback

  return (
    <section
      aria-live="polite"
      className={`${styles.feedback} ${styles.success}`}
      data-testid="catalog-command-success"
    >
      <strong>{feedback.replayed ? 'Command replayed safely' : 'Command completed'}</strong>
      {result.warnings?.length ? (
        <div className={styles.warning} data-testid="catalog-command-warnings" role="status">
          <strong>Review suggested</strong>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning.code}>
                <code>{warning.code}</code>: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className={styles.result}>
        <dt>Entity</dt>
        <dd data-testid="catalog-result-entity-type">{result.entityType}</dd>
        <dt>Stable ID</dt>
        <dd>
          <code data-testid="catalog-result-stable-id">{result.stableId}</code>
        </dd>
        {result.relatedStableId ? (
          <>
            <dt>Related stable ID</dt>
            <dd>
              <code data-testid="catalog-result-related-stable-id">{result.relatedStableId}</code>
            </dd>
          </>
        ) : null}
        <dt>Lock version</dt>
        <dd data-testid="catalog-result-lock-version">{result.lockVersion}</dd>
        {result.status ? (
          <>
            <dt>Status</dt>
            <dd data-testid="catalog-result-status">{result.status}</dd>
          </>
        ) : null}
        <dt>Operation ID</dt>
        <dd>
          <code data-testid="catalog-result-operation-id">{result.operationId}</code>
        </dd>
      </dl>
    </section>
  )
}

export function CatalogOperationsClient({ initialOperationId }: CatalogOperationsClientProps) {
  const [operationId, setOperationId] = useState(initialOperationId)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  async function runCommand(draft: CatalogCommandDraft) {
    setPending(true)
    setFeedback(null)

    const command = { ...draft, operationId } as CatalogCommand

    try {
      const response = await fetch(CATALOG_COMMAND_ENDPOINT, {
        body: JSON.stringify(command),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body: unknown = await response.json().catch(() => null)

      if (isSuccessEnvelope(body)) {
        setFeedback({ kind: 'success', replayed: body.replayed, result: body.result })
        setOperationId(globalThis.crypto.randomUUID())
        return
      }

      if (isFailureEnvelope(body)) {
        setFeedback({
          code: body.error.code,
          details: body.error.details,
          kind: 'error',
          message: body.error.message,
        })
        return
      }

      setFeedback({
        code: response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`,
        kind: 'error',
        message: 'The catalog command endpoint returned an unexpected response.',
      })
    } catch (error) {
      setFeedback({
        code: 'NETWORK_ERROR',
        details: error instanceof Error ? error.message : String(error),
        kind: 'error',
        message: 'The catalog command could not be sent. Retry with the same operation ID.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <main className={styles.page} data-testid="catalog-operations-view">
      <header className={styles.header}>
        <h1 data-testid="catalog-operations-title">Catalog Operations</h1>
        <p className={styles.lede}>
          Maintain formal catalog records through audited domain commands. These forms never call
          generic collection CRUD or GraphQL mutations.
        </p>
        <div className={styles.operationBar}>
          <strong>Next operation ID</strong>
          <code data-testid="catalog-operation-id">{operationId}</code>
          <span className={styles.hint}>Retained after failure for an idempotent retry.</span>
        </div>
      </header>

      <FeedbackPanel feedback={feedback} />

      <section className={styles.entitySection} data-testid="work-operations">
        <h2>Work</h2>
        <div className={styles.cardGrid}>
          <CommandForm
            buildCommand={(data) => ({
              displayName: requiredText(data, 'displayName'),
              originalName: optionalText(data, 'originalName'),
              reason: requiredText(data, 'reason'),
              type: 'createWork',
              workType: optionalChoice<WorkType>(data, 'workType'),
            })}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Create work"
            testId="create-work-form"
            title="Create work"
          >
            <Field id="create-work-display-name" label="Display name">
              <input
                data-testid="create-work-display-name"
                id="create-work-display-name"
                name="displayName"
                required
                type="text"
              />
            </Field>
            <Field id="create-work-original-name" label="Original name (optional)">
              <input id="create-work-original-name" name="originalName" type="text" />
            </Field>
            <Field id="create-work-type" label="Work type (optional)">
              <select id="create-work-type" name="workType">
                <option value="">Not specified</option>
                <Options values={WORK_TYPES} />
              </select>
            </Field>
            <Field id="create-work-reason" label="Operation reason">
              <textarea id="create-work-reason" name="reason" required rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              displayName: optionalText(data, 'displayName'),
              originalName: optionalText(data, 'originalName'),
              type: 'updateWork',
              workType: optionalChoice<WorkType>(data, 'workType'),
            })}
            description="Blank update fields are left unchanged."
            onCommand={runCommand}
            pending={pending}
            submitLabel="Update work"
            testId="update-work-form"
            title="Update work"
          >
            <VersionedFields prefix="update-work" />
            <Field id="update-work-display-name" label="New display name (optional)">
              <input id="update-work-display-name" name="displayName" type="text" />
            </Field>
            <Field id="update-work-original-name" label="New original name (optional)">
              <input id="update-work-original-name" name="originalName" type="text" />
            </Field>
            <Field id="update-work-type" label="New work type (optional)">
              <select id="update-work-type" name="workType">
                <option value="">Leave unchanged</option>
                <Options values={WORK_TYPES} />
              </select>
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const base = versionedFields(data)
              const action = requiredChoice<
                'restoreWork' | 'setWorkPublicationStatus' | 'softDeleteWork'
              >(data, 'action')

              if (action === 'setWorkPublicationStatus') {
                return {
                  ...base,
                  publicationStatus: requiredChoice<WorkPublicationStatus>(
                    data,
                    'publicationStatus',
                  ),
                  type: action,
                }
              }

              return { ...base, type: action }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Apply work action"
            testId="work-lifecycle-form"
            title="Publication and lifecycle"
          >
            <VersionedFields prefix="work-lifecycle" />
            <Field id="work-lifecycle-action" label="Action">
              <select id="work-lifecycle-action" name="action" required>
                <option value="setWorkPublicationStatus">Set publication status</option>
                <option value="softDeleteWork">Soft delete</option>
                <option value="restoreWork">Restore</option>
              </select>
            </Field>
            <Field id="work-publication-status" label="Publication status">
              <select id="work-publication-status" name="publicationStatus" required>
                <Options values={WORK_PUBLICATION_STATUSES} />
              </select>
            </Field>
          </CommandForm>
        </div>
      </section>

      <section className={styles.entitySection} data-testid="character-operations">
        <h2>Character</h2>
        <div className={styles.cardGrid}>
          <CommandForm
            buildCommand={(data) => ({
              displayName: requiredText(data, 'displayName'),
              nameEn: optionalText(data, 'nameEn'),
              nameJa: optionalText(data, 'nameJa'),
              nameZh: optionalText(data, 'nameZh'),
              reason: requiredText(data, 'reason'),
              status: optionalChoice<CharacterStatus>(data, 'status'),
              type: 'createCharacter',
              workStableId: optionalText(data, 'workStableId'),
            })}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Create character"
            testId="create-character-form"
            title="Create character"
          >
            <Field id="create-character-display-name" label="Display name">
              <input id="create-character-display-name" name="displayName" required type="text" />
            </Field>
            <Field id="create-character-name-zh" label="Chinese name (optional)">
              <input id="create-character-name-zh" name="nameZh" type="text" />
            </Field>
            <Field id="create-character-name-ja" label="Japanese name (optional)">
              <input id="create-character-name-ja" name="nameJa" type="text" />
            </Field>
            <Field id="create-character-name-en" label="English name (optional)">
              <input id="create-character-name-en" name="nameEn" type="text" />
            </Field>
            <Field id="create-character-work-id" label="Work stable ID (optional)">
              <input id="create-character-work-id" name="workStableId" type="text" />
            </Field>
            <Field id="create-character-status" label="Initial status (optional)">
              <select id="create-character-status" name="status">
                <option value="">Use domain default</option>
                <Options values={CHARACTER_STATUSES} />
              </select>
            </Field>
            <Field id="create-character-reason" label="Operation reason">
              <textarea id="create-character-reason" name="reason" required rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              displayName: optionalText(data, 'displayName'),
              nameEn: optionalText(data, 'nameEn'),
              nameJa: optionalText(data, 'nameJa'),
              nameZh: optionalText(data, 'nameZh'),
              type: 'updateCharacter',
              workStableId: optionalText(data, 'workStableId'),
            })}
            description="Blank update fields are left unchanged."
            onCommand={runCommand}
            pending={pending}
            submitLabel="Update character"
            testId="update-character-form"
            title="Update character"
          >
            <VersionedFields prefix="update-character" />
            <Field id="update-character-display-name" label="New display name (optional)">
              <input id="update-character-display-name" name="displayName" type="text" />
            </Field>
            <Field id="update-character-name-zh" label="New Chinese name (optional)">
              <input id="update-character-name-zh" name="nameZh" type="text" />
            </Field>
            <Field id="update-character-name-ja" label="New Japanese name (optional)">
              <input id="update-character-name-ja" name="nameJa" type="text" />
            </Field>
            <Field id="update-character-name-en" label="New English name (optional)">
              <input id="update-character-name-en" name="nameEn" type="text" />
            </Field>
            <Field id="update-character-work-id" label="New work stable ID (optional)">
              <input id="update-character-work-id" name="workStableId" type="text" />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              aliasType: requiredChoice<CharacterAliasType>(data, 'aliasType'),
              isPreferred: isChecked(data, 'isPreferred'),
              locale: optionalText(data, 'locale'),
              type: 'addCharacterAlias',
              value: requiredText(data, 'value'),
            })}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Add alias"
            testId="add-character-alias-form"
            title="Add character alias"
          >
            <VersionedFields prefix="add-character-alias" />
            <Field id="character-alias-value" label="Alias value">
              <input id="character-alias-value" name="value" required type="text" />
            </Field>
            <Field id="character-alias-type" label="Alias type">
              <select id="character-alias-type" name="aliasType" required>
                <Options values={CHARACTER_ALIAS_TYPES} />
              </select>
            </Field>
            <Field id="character-alias-locale" label="Locale (optional)">
              <input id="character-alias-locale" name="locale" placeholder="zh-CN" type="text" />
            </Field>
            <div className={styles.checkbox}>
              <input id="character-alias-preferred" name="isPreferred" type="checkbox" />
              <label htmlFor="character-alias-preferred">Preferred alias</label>
            </div>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const base = versionedFields(data)
              const action = requiredChoice<
                'restoreCharacter' | 'setCharacterStatus' | 'softDeleteCharacter'
              >(data, 'action')

              if (action === 'setCharacterStatus') {
                return {
                  ...base,
                  status: requiredChoice<CharacterStatus>(data, 'status'),
                  type: action,
                }
              }

              return { ...base, type: action }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Apply character action"
            testId="character-lifecycle-form"
            title="Status and lifecycle"
          >
            <VersionedFields prefix="character-lifecycle" />
            <Field id="character-lifecycle-action" label="Action">
              <select id="character-lifecycle-action" name="action" required>
                <option value="setCharacterStatus">Set status</option>
                <option value="softDeleteCharacter">Soft delete</option>
                <option value="restoreCharacter">Restore</option>
              </select>
            </Field>
            <Field id="character-lifecycle-status" label="Character status">
              <select id="character-lifecycle-status" name="status" required>
                <Options values={CHARACTER_STATUSES} />
              </select>
            </Field>
          </CommandForm>
        </div>
      </section>

      <section className={styles.entitySection} data-testid="manufacturer-operations">
        <h2>Manufacturer</h2>
        <div className={styles.cardGrid}>
          <CommandForm
            buildCommand={(data) => {
              const aliasValue = optionalText(data, 'aliasValue')
              const aliasLocale = optionalText(data, 'aliasLocale')

              return {
                aliases: aliasValue ? [{ locale: aliasLocale, value: aliasValue }] : undefined,
                authorizationNote: optionalText(data, 'authorizationNote'),
                canonicalName: requiredText(data, 'canonicalName'),
                officialSiteUrl: optionalText(data, 'officialSiteUrl'),
                reason: requiredText(data, 'reason'),
                type: 'createManufacturer',
              }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Create manufacturer"
            testId="create-manufacturer-form"
            title="Create manufacturer"
          >
            <Field id="create-manufacturer-name" label="Canonical name">
              <input id="create-manufacturer-name" name="canonicalName" required type="text" />
            </Field>
            <Field id="create-manufacturer-alias" label="Initial alias (optional)">
              <input id="create-manufacturer-alias" name="aliasValue" type="text" />
            </Field>
            <Field id="create-manufacturer-alias-locale" label="Alias locale (optional)">
              <input id="create-manufacturer-alias-locale" name="aliasLocale" type="text" />
            </Field>
            <Field id="create-manufacturer-site" label="Official site URL (optional)">
              <input id="create-manufacturer-site" name="officialSiteUrl" type="url" />
            </Field>
            <Field id="create-manufacturer-authorization" label="Authorization note (optional)">
              <textarea id="create-manufacturer-authorization" name="authorizationNote" rows={3} />
            </Field>
            <Field id="create-manufacturer-reason" label="Operation reason">
              <textarea id="create-manufacturer-reason" name="reason" required rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const aliasValue = optionalText(data, 'aliasValue')
              const aliasLocale = optionalText(data, 'aliasLocale')

              return {
                ...versionedFields(data),
                aliases: aliasValue ? [{ locale: aliasLocale, value: aliasValue }] : undefined,
                authorizationNote: optionalText(data, 'authorizationNote'),
                canonicalName: optionalText(data, 'canonicalName'),
                officialSiteUrl: optionalText(data, 'officialSiteUrl'),
                type: 'updateManufacturer',
              }
            }}
            description="Blank update fields are left unchanged."
            onCommand={runCommand}
            pending={pending}
            submitLabel="Update manufacturer"
            testId="update-manufacturer-form"
            title="Update manufacturer"
          >
            <VersionedFields prefix="update-manufacturer" />
            <Field id="update-manufacturer-name" label="New canonical name (optional)">
              <input id="update-manufacturer-name" name="canonicalName" type="text" />
            </Field>
            <Field id="update-manufacturer-alias" label="Replacement alias (optional)">
              <input id="update-manufacturer-alias" name="aliasValue" type="text" />
            </Field>
            <Field id="update-manufacturer-alias-locale" label="Alias locale (optional)">
              <input id="update-manufacturer-alias-locale" name="aliasLocale" type="text" />
            </Field>
            <Field id="update-manufacturer-site" label="New official site URL (optional)">
              <input id="update-manufacturer-site" name="officialSiteUrl" type="url" />
            </Field>
            <Field id="update-manufacturer-authorization" label="New authorization note (optional)">
              <textarea id="update-manufacturer-authorization" name="authorizationNote" rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const base = versionedFields(data)
              const action = requiredChoice<
                'restoreManufacturer' | 'setManufacturerStatus' | 'softDeleteManufacturer'
              >(data, 'action')

              if (action === 'setManufacturerStatus') {
                return {
                  ...base,
                  status: requiredChoice<ManufacturerStatus>(data, 'status'),
                  type: action,
                }
              }

              return { ...base, type: action }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Apply manufacturer action"
            testId="manufacturer-lifecycle-form"
            title="Status and lifecycle"
          >
            <VersionedFields prefix="manufacturer-lifecycle" />
            <Field id="manufacturer-lifecycle-action" label="Action">
              <select id="manufacturer-lifecycle-action" name="action" required>
                <option value="setManufacturerStatus">Set status</option>
                <option value="softDeleteManufacturer">Soft delete</option>
                <option value="restoreManufacturer">Restore</option>
              </select>
            </Field>
            <Field id="manufacturer-lifecycle-status" label="Manufacturer status">
              <select id="manufacturer-lifecycle-status" name="status" required>
                <Options values={MANUFACTURER_STATUSES} />
              </select>
            </Field>
          </CommandForm>
        </div>
      </section>

      <section className={styles.entitySection} data-testid="figure-prototype-operations">
        <h2>Figure Prototype</h2>
        <div className={styles.cardGrid}>
          <CommandForm
            buildCommand={(data) => {
              const secondaryCharacter = optionalText(data, 'secondaryCharacterStableId')
              const characters: PrototypeCharacterCommandInput[] = [
                {
                  characterStableId: requiredText(data, 'primaryCharacterStableId'),
                  displayOrder: 0,
                  role: 'primary',
                },
              ]

              if (secondaryCharacter) {
                characters.push({
                  characterStableId: secondaryCharacter,
                  displayOrder: 1,
                  role: requiredChoice<PrototypeCharacterRole>(data, 'secondaryCharacterRole'),
                })
              }

              return {
                characters,
                costumeText: optionalText(data, 'costumeText'),
                figureType: requiredChoice<FigureType>(data, 'figureType'),
                isGroup: isChecked(data, 'isGroup'),
                manufacturerStableId: requiredText(data, 'manufacturerStableId'),
                reason: requiredText(data, 'reason'),
                scale: optionalText(data, 'scale'),
                title: requiredText(data, 'title'),
                type: 'createFigurePrototype',
                workStableId: optionalText(data, 'workStableId'),
              }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Create prototype"
            testId="create-figure-prototype-form"
            title="Create figure prototype"
          >
            <Field id="create-prototype-title" label="Title">
              <input id="create-prototype-title" name="title" required type="text" />
            </Field>
            <Field id="create-prototype-manufacturer" label="Manufacturer stable ID">
              <input
                id="create-prototype-manufacturer"
                name="manufacturerStableId"
                required
                type="text"
              />
            </Field>
            <Field id="create-prototype-work" label="Work stable ID (optional)">
              <input id="create-prototype-work" name="workStableId" type="text" />
            </Field>
            <Field id="create-prototype-primary-character" label="Primary character stable ID">
              <input
                id="create-prototype-primary-character"
                name="primaryCharacterStableId"
                required
                type="text"
              />
            </Field>
            <Field
              id="create-prototype-secondary-character"
              label="Second character stable ID (optional)"
            >
              <input
                id="create-prototype-secondary-character"
                name="secondaryCharacterStableId"
                type="text"
              />
            </Field>
            <Field id="create-prototype-secondary-role" label="Second character role">
              <select id="create-prototype-secondary-role" name="secondaryCharacterRole" required>
                <Options values={PROTOTYPE_CHARACTER_ROLES} />
              </select>
            </Field>
            <Field id="create-prototype-type" label="Figure type">
              <select id="create-prototype-type" name="figureType" required>
                <Options values={FIGURE_TYPES} />
              </select>
            </Field>
            <Field id="create-prototype-scale" label="Scale text (optional)">
              <input id="create-prototype-scale" name="scale" placeholder="1/7" type="text" />
            </Field>
            <Field id="create-prototype-costume" label="Costume or skin text (optional)">
              <input id="create-prototype-costume" name="costumeText" type="text" />
            </Field>
            <div className={styles.checkbox}>
              <input id="create-prototype-group" name="isGroup" type="checkbox" />
              <label htmlFor="create-prototype-group">Multi-character prototype</label>
            </div>
            <Field id="create-prototype-reason" label="Operation reason">
              <textarea id="create-prototype-reason" name="reason" required rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              costumeText: optionalText(data, 'costumeText'),
              figureType: optionalChoice<FigureType>(data, 'figureType'),
              manufacturerStableId: optionalText(data, 'manufacturerStableId'),
              scale: optionalText(data, 'scale'),
              title: optionalText(data, 'title'),
              type: 'updateFigurePrototype',
              workStableId: optionalText(data, 'workStableId'),
            })}
            description="Blank update fields are left unchanged. Character membership has a separate audited command."
            onCommand={runCommand}
            pending={pending}
            submitLabel="Update prototype"
            testId="update-figure-prototype-form"
            title="Update figure prototype"
          >
            <VersionedFields prefix="update-figure-prototype" />
            <Field id="update-prototype-title" label="New title (optional)">
              <input id="update-prototype-title" name="title" type="text" />
            </Field>
            <Field id="update-prototype-manufacturer" label="New manufacturer stable ID (optional)">
              <input id="update-prototype-manufacturer" name="manufacturerStableId" type="text" />
            </Field>
            <Field id="update-prototype-work" label="New work stable ID (optional)">
              <input id="update-prototype-work" name="workStableId" type="text" />
            </Field>
            <Field id="update-prototype-type" label="New figure type (optional)">
              <select id="update-prototype-type" name="figureType">
                <option value="">Leave unchanged</option>
                <Options values={FIGURE_TYPES} />
              </select>
            </Field>
            <Field id="update-prototype-scale" label="New scale text (optional)">
              <input id="update-prototype-scale" name="scale" type="text" />
            </Field>
            <Field id="update-prototype-costume" label="New costume text (optional)">
              <input id="update-prototype-costume" name="costumeText" type="text" />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const base = versionedFields(data)
              const reviewType = requiredChoice<
                'reviewPrototypeAuthorization' | 'reviewPrototypeInclusion'
              >(data, 'reviewType')

              if (reviewType === 'reviewPrototypeAuthorization') {
                return {
                  ...base,
                  authorizationEvidence: optionalText(data, 'authorizationEvidence'),
                  authorizationStatus: requiredChoice<
                    (typeof AUTHORIZATION_REVIEW_STATUSES)[number]
                  >(data, 'authorizationStatus'),
                  type: reviewType,
                }
              }

              return {
                ...base,
                inclusionStatus: requiredChoice<(typeof INCLUSION_REVIEW_STATUSES)[number]>(
                  data,
                  'inclusionStatus',
                ),
                type: reviewType,
              }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Submit review decision"
            testId="review-figure-prototype-form"
            title="Review inclusion or authorization"
          >
            <VersionedFields prefix="review-figure-prototype" />
            <Field id="prototype-review-type" label="Review decision type">
              <select id="prototype-review-type" name="reviewType" required>
                <option value="reviewPrototypeAuthorization">Authorization</option>
                <option value="reviewPrototypeInclusion">Inclusion</option>
              </select>
            </Field>
            <Field id="prototype-authorization-status" label="Authorization status">
              <select id="prototype-authorization-status" name="authorizationStatus" required>
                <Options values={AUTHORIZATION_REVIEW_STATUSES} />
              </select>
            </Field>
            <Field id="prototype-authorization-evidence" label="Authorization evidence (optional)">
              <textarea
                id="prototype-authorization-evidence"
                name="authorizationEvidence"
                rows={3}
              />
            </Field>
            <Field id="prototype-inclusion-status" label="Inclusion status">
              <select id="prototype-inclusion-status" name="inclusionStatus" required>
                <Options values={INCLUSION_REVIEW_STATUSES} />
              </select>
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => {
              const base = versionedFields(data)
              const action = requiredChoice<
                'archivePrototype' | 'restorePrototype' | 'setPrototypePublicationStatus'
              >(data, 'action')

              if (action === 'setPrototypePublicationStatus') {
                return {
                  ...base,
                  publicationStatus: requiredChoice<PrototypePublicationStatus>(
                    data,
                    'publicationStatus',
                  ),
                  type: action,
                }
              }

              return { ...base, type: action }
            }}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Apply prototype action"
            testId="figure-prototype-lifecycle-form"
            title="Publication and lifecycle"
          >
            <VersionedFields prefix="figure-prototype-lifecycle" />
            <Field id="prototype-lifecycle-action" label="Action">
              <select id="prototype-lifecycle-action" name="action" required>
                <option value="setPrototypePublicationStatus">Set publication status</option>
                <option value="archivePrototype">Archive</option>
                <option value="restorePrototype">Restore</option>
              </select>
            </Field>
            <Field id="prototype-publication-status" label="Publication status">
              <select id="prototype-publication-status" name="publicationStatus" required>
                <Options values={PROTOTYPE_PUBLICATION_STATUSES} />
              </select>
            </Field>
          </CommandForm>
        </div>
      </section>

      <section className={styles.entitySection} data-testid="figure-version-operations">
        <h2>Figure Version</h2>
        <div className={styles.cardGrid}>
          <CommandForm
            buildCommand={(data) => ({
              channelOrDistributorLabel: optionalText(data, 'channelOrDistributorLabel'),
              grayModelCompleteness: requiredChoice<GrayModelCompleteness>(
                data,
                'grayModelCompleteness',
              ),
              kind: requiredChoice<FigureVersionKind>(data, 'kind'),
              name: requiredText(data, 'name'),
              notes: optionalText(data, 'notes'),
              prototypeStableId: requiredText(data, 'prototypeStableId'),
              reason: requiredText(data, 'reason'),
              releaseDate: optionalText(data, 'releaseDate'),
              releaseStatus: requiredChoice<FigureReleaseStatus>(data, 'releaseStatus'),
              skuOrCode: optionalText(data, 'skuOrCode'),
              type: 'createFigureVersion',
            })}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Create figure version"
            testId="create-figure-version-form"
            title="Create figure version"
          >
            <Field id="create-version-prototype" label="Prototype stable ID">
              <input id="create-version-prototype" name="prototypeStableId" required type="text" />
            </Field>
            <Field id="create-version-name" label="Version name">
              <input id="create-version-name" name="name" required type="text" />
            </Field>
            <Field id="create-version-kind" label="Version kind">
              <select id="create-version-kind" name="kind" required>
                <Options values={FIGURE_VERSION_KINDS} />
              </select>
            </Field>
            <Field id="create-version-release-status" label="Release status">
              <select id="create-version-release-status" name="releaseStatus" required>
                <Options values={FIGURE_RELEASE_STATUSES} />
              </select>
            </Field>
            <Field id="create-version-gray-completeness" label="Gray model completeness">
              <select id="create-version-gray-completeness" name="grayModelCompleteness" required>
                <Options values={GRAY_MODEL_COMPLETENESS} />
              </select>
            </Field>
            <Field id="create-version-release-date" label="Release date (optional)">
              <input id="create-version-release-date" name="releaseDate" type="date" />
            </Field>
            <Field id="create-version-sku" label="SKU or code (optional)">
              <input id="create-version-sku" name="skuOrCode" type="text" />
            </Field>
            <Field id="create-version-channel" label="Channel or distributor (optional)">
              <input id="create-version-channel" name="channelOrDistributorLabel" type="text" />
            </Field>
            <Field id="create-version-notes" label="Notes (optional)">
              <textarea id="create-version-notes" name="notes" rows={3} />
            </Field>
            <Field id="create-version-reason" label="Operation reason">
              <textarea id="create-version-reason" name="reason" required rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              channelOrDistributorLabel: optionalText(data, 'channelOrDistributorLabel'),
              grayModelCompleteness: optionalChoice<GrayModelCompleteness>(
                data,
                'grayModelCompleteness',
              ),
              kind: optionalChoice<FigureVersionKind>(data, 'kind'),
              name: optionalText(data, 'name'),
              notes: optionalText(data, 'notes'),
              releaseDate: optionalText(data, 'releaseDate'),
              releaseStatus: optionalChoice<FigureReleaseStatus>(data, 'releaseStatus'),
              skuOrCode: optionalText(data, 'skuOrCode'),
              type: 'updateFigureVersion',
            })}
            description="Blank update fields are left unchanged."
            onCommand={runCommand}
            pending={pending}
            submitLabel="Update figure version"
            testId="update-figure-version-form"
            title="Update figure version"
          >
            <VersionedFields prefix="update-figure-version" />
            <Field id="update-version-name" label="New version name (optional)">
              <input id="update-version-name" name="name" type="text" />
            </Field>
            <Field id="update-version-kind" label="New version kind (optional)">
              <select id="update-version-kind" name="kind">
                <option value="">Leave unchanged</option>
                <Options values={FIGURE_VERSION_KINDS} />
              </select>
            </Field>
            <Field id="update-version-release-status" label="New release status (optional)">
              <select id="update-version-release-status" name="releaseStatus">
                <option value="">Leave unchanged</option>
                <Options values={FIGURE_RELEASE_STATUSES} />
              </select>
            </Field>
            <Field
              id="update-version-gray-completeness"
              label="New gray model completeness (optional)"
            >
              <select id="update-version-gray-completeness" name="grayModelCompleteness">
                <option value="">Leave unchanged</option>
                <Options values={GRAY_MODEL_COMPLETENESS} />
              </select>
            </Field>
            <Field id="update-version-release-date" label="New release date (optional)">
              <input id="update-version-release-date" name="releaseDate" type="date" />
            </Field>
            <Field id="update-version-sku" label="New SKU or code (optional)">
              <input id="update-version-sku" name="skuOrCode" type="text" />
            </Field>
            <Field id="update-version-channel" label="New channel or distributor (optional)">
              <input id="update-version-channel" name="channelOrDistributorLabel" type="text" />
            </Field>
            <Field id="update-version-notes" label="New notes (optional)">
              <textarea id="update-version-notes" name="notes" rows={3} />
            </Field>
          </CommandForm>

          <CommandForm
            buildCommand={(data) => ({
              ...versionedFields(data),
              type: requiredChoice<'restoreFigureVersion' | 'softDeleteFigureVersion'>(
                data,
                'action',
              ),
            })}
            onCommand={runCommand}
            pending={pending}
            submitLabel="Apply version action"
            testId="figure-version-lifecycle-form"
            title="Version lifecycle"
          >
            <VersionedFields prefix="figure-version-lifecycle" />
            <Field id="figure-version-lifecycle-action" label="Action">
              <select id="figure-version-lifecycle-action" name="action" required>
                <option value="softDeleteFigureVersion">Soft delete</option>
                <option value="restoreFigureVersion">Restore</option>
              </select>
            </Field>
          </CommandForm>
        </div>
      </section>
    </main>
  )
}
