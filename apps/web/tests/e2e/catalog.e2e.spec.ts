import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { monitorLoopbackRequests } from './network-guard'

type CommandResult = {
  lockVersion: number
  operationId: string
  relatedStableId?: string
  stableId: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requiredEnvironmentVariable(name: 'PR01_ADMIN_EMAIL' | 'PR01_ADMIN_PASSWORD'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required for the PR-01 authenticated browser gate.`)
  }
  return value
}

async function loginAsCatalogAdministrator(page: Page): Promise<void> {
  await page.goto('/admin/login')
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await page.locator('input[name="email"]').fill(requiredEnvironmentVariable('PR01_ADMIN_EMAIL'))
  await page
    .locator('input[name="password"]')
    .fill(requiredEnvironmentVariable('PR01_ADMIN_PASSWORD'))
  await page.locator('button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/admin\/login(?:\?|$)/)
}

async function fillVersionedCommand(
  form: Locator,
  stableId: string,
  expectedVersion: number,
  reason: string,
): Promise<void> {
  await form.getByLabel('Stable ID', { exact: true }).fill(stableId)
  await form.getByLabel('Expected lock version', { exact: true }).fill(String(expectedVersion))
  await form.getByLabel('Operation reason', { exact: true }).fill(reason)
}

async function submitCommand(page: Page, form: Locator): Promise<CommandResult> {
  const operationId = (await page.getByTestId('catalog-operation-id').innerText()).trim()

  await form.locator('button[type="submit"]').click()
  await expect(page.getByTestId('catalog-command-success')).toBeVisible()
  await expect(page.getByTestId('catalog-result-operation-id')).toHaveText(operationId)

  const stableId = (await page.getByTestId('catalog-result-stable-id').innerText()).trim()
  const lockVersion = Number(await page.getByTestId('catalog-result-lock-version').innerText())
  const relatedStableIdLocator = page.getByTestId('catalog-result-related-stable-id')
  const relatedStableId =
    (await relatedStableIdLocator.count()) > 0
      ? (await relatedStableIdLocator.innerText()).trim()
      : undefined

  expect(stableId).toMatch(UUID_PATTERN)
  expect(lockVersion).toBeGreaterThanOrEqual(1)
  if (relatedStableId) expect(relatedStableId).toMatch(UUID_PATTERN)

  return { lockVersion, operationId, relatedStableId, stableId }
}

async function expectCatalogListItem(
  page: Page,
  slug: string,
  displayValue: string,
): Promise<void> {
  await page.goto(`/admin/collections/${slug}`)
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${slug}(?:\\?|$)`))
  await expect(page.getByText(displayValue, { exact: true }).first()).toBeVisible()
}

test.describe('PR-01 core catalog Admin operations', () => {
  test('maintains a qualifying synthetic catalog only through audited commands', async ({
    page,
  }) => {
    const assertNoExternalRequests = monitorLoopbackRequests(page)
    const marker = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const workName = `Synthetic Work ${marker}`
    const manufacturerName = `Synthetic Manufacturer ${marker}`
    const characterName = `Synthetic Character ${marker}`
    const characterAlias = `Synthetic Alias ${marker}`
    const prototypeName = `Synthetic Prototype ${marker}`
    const versionName = `Synthetic Version ${marker}`
    const successfulOperationIds: string[] = []

    await page.goto('/admin/login')
    const unauthenticatedStatus = await page.evaluate(async (operationId) => {
      const response = await fetch('/api/admin/catalog/commands', {
        body: JSON.stringify({
          displayName: 'Rejected anonymous work',
          operationId,
          reason: 'Synthetic anonymous attack.',
          type: 'createWork',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      return response.status
    }, randomUUID())
    expect(unauthenticatedStatus).toBe(401)

    await loginAsCatalogAdministrator(page)
    await page.goto('/admin/catalog-operations')
    await expect(page.getByTestId('catalog-operations-title')).toHaveText('Catalog Operations')

    const createWorkForm = page.getByTestId('create-work-form')
    await createWorkForm.getByLabel('Display name', { exact: true }).fill(workName)
    await createWorkForm.getByLabel('Original name (optional)', { exact: true }).fill(workName)
    await createWorkForm
      .getByLabel('Work type (optional)', { exact: true })
      .selectOption('animation')
    await createWorkForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create synthetic work.')
    const work = await submitCommand(page, createWorkForm)
    successfulOperationIds.push(work.operationId)

    await createWorkForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create a same-name synthetic Work to verify the non-blocking duplicate warning.')
    const duplicateWork = await submitCommand(page, createWorkForm)
    await expect(page.getByTestId('catalog-command-warnings')).toContainText(
      'WORK_NORMALIZED_NAME_DUPLICATE',
    )
    successfulOperationIds.push(duplicateWork.operationId)

    const createManufacturerForm = page.getByTestId('create-manufacturer-form')
    await createManufacturerForm
      .getByLabel('Canonical name', { exact: true })
      .fill(manufacturerName)
    await createManufacturerForm
      .getByLabel('Initial alias (optional)', { exact: true })
      .fill(`Alias ${manufacturerName}`)
    await createManufacturerForm.getByLabel('Alias locale (optional)', { exact: true }).fill('en')
    await createManufacturerForm
      .getByLabel('Authorization note (optional)', { exact: true })
      .fill('Synthetic authorization evidence only.')
    await createManufacturerForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create synthetic manufacturer.')
    const manufacturerDraft = await submitCommand(page, createManufacturerForm)
    successfulOperationIds.push(manufacturerDraft.operationId)

    const manufacturerLifecycleForm = page.getByTestId('manufacturer-lifecycle-form')
    await fillVersionedCommand(
      manufacturerLifecycleForm,
      manufacturerDraft.stableId,
      manufacturerDraft.lockVersion,
      'Activate synthetic manufacturer.',
    )
    await manufacturerLifecycleForm
      .getByLabel('Action', { exact: true })
      .selectOption('setManufacturerStatus')
    await manufacturerLifecycleForm
      .getByLabel('Manufacturer status', { exact: true })
      .selectOption('active')
    const manufacturer = await submitCommand(page, manufacturerLifecycleForm)
    expect(manufacturer.stableId).toBe(manufacturerDraft.stableId)
    expect(manufacturer.lockVersion).toBe(manufacturerDraft.lockVersion + 1)
    successfulOperationIds.push(manufacturer.operationId)

    const createCharacterForm = page.getByTestId('create-character-form')
    await createCharacterForm.getByLabel('Display name', { exact: true }).fill(characterName)
    await createCharacterForm
      .getByLabel('Chinese name (optional)', { exact: true })
      .fill(`中文 ${marker}`)
    await createCharacterForm
      .getByLabel('Japanese name (optional)', { exact: true })
      .fill(`日本語 ${marker}`)
    await createCharacterForm
      .getByLabel('English name (optional)', { exact: true })
      .fill(characterName)
    await createCharacterForm
      .getByLabel('Work stable ID (optional)', { exact: true })
      .fill(work.stableId)
    await createCharacterForm
      .getByLabel('Initial status (optional)', { exact: true })
      .selectOption('active')
    await createCharacterForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create active synthetic character.')
    const characterDraft = await submitCommand(page, createCharacterForm)
    successfulOperationIds.push(characterDraft.operationId)

    const addAliasForm = page.getByTestId('add-character-alias-form')
    await fillVersionedCommand(
      addAliasForm,
      characterDraft.stableId,
      characterDraft.lockVersion,
      'Add synthetic searchable alias.',
    )
    await addAliasForm.getByLabel('Alias value', { exact: true }).fill(characterAlias)
    await addAliasForm.getByLabel('Alias type', { exact: true }).selectOption('translation')
    await addAliasForm.getByLabel('Locale (optional)', { exact: true }).fill('en')
    await addAliasForm.getByLabel('Preferred alias', { exact: true }).check()
    const character = await submitCommand(page, addAliasForm)
    expect(character.stableId).toBe(characterDraft.stableId)
    expect(character.lockVersion).toBe(characterDraft.lockVersion + 1)
    expect(character.relatedStableId).toMatch(UUID_PATTERN)
    successfulOperationIds.push(character.operationId)

    const createPrototypeForm = page.getByTestId('create-figure-prototype-form')
    await createPrototypeForm.getByLabel('Title', { exact: true }).fill(prototypeName)
    await createPrototypeForm
      .getByLabel('Manufacturer stable ID', { exact: true })
      .fill(manufacturer.stableId)
    await createPrototypeForm
      .getByLabel('Work stable ID (optional)', { exact: true })
      .fill(work.stableId)
    await createPrototypeForm
      .getByLabel('Primary character stable ID', { exact: true })
      .fill(character.stableId)
    await createPrototypeForm.getByLabel('Figure type', { exact: true }).selectOption('scale')
    await createPrototypeForm.getByLabel('Scale text (optional)', { exact: true }).fill('1/7')
    await createPrototypeForm
      .getByLabel('Costume or skin text (optional)', { exact: true })
      .fill('Synthetic costume')
    await createPrototypeForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create synthetic prototype with its primary character relation.')
    const prototypeDraft = await submitCommand(page, createPrototypeForm)
    successfulOperationIds.push(prototypeDraft.operationId)

    const createVersionForm = page.getByTestId('create-figure-version-form')
    await createVersionForm
      .getByLabel('Prototype stable ID', { exact: true })
      .fill(prototypeDraft.stableId)
    await createVersionForm.getByLabel('Version name', { exact: true }).fill(versionName)
    await createVersionForm.getByLabel('Version kind', { exact: true }).selectOption('regular')
    await createVersionForm.getByLabel('Release status', { exact: true }).selectOption('released')
    await createVersionForm
      .getByLabel('Gray model completeness', { exact: true })
      .selectOption('not_applicable')
    await createVersionForm
      .getByLabel('Operation reason', { exact: true })
      .fill('Create a qualifying released synthetic version.')
    const version = await submitCommand(page, createVersionForm)
    successfulOperationIds.push(version.operationId)

    const reviewPrototypeForm = page.getByTestId('review-figure-prototype-form')
    await fillVersionedCommand(
      reviewPrototypeForm,
      prototypeDraft.stableId,
      prototypeDraft.lockVersion,
      'Accept synthetic third-party authorization evidence.',
    )
    await reviewPrototypeForm
      .getByLabel('Review decision type', { exact: true })
      .selectOption('reviewPrototypeAuthorization')
    const authorizationStatus = reviewPrototypeForm.getByLabel('Authorization status', {
      exact: true,
    })
    await expect(authorizationStatus.locator('option[value="official"]')).toHaveCount(1)
    await expect(authorizationStatus.locator('option[value="authorized_third_party"]')).toHaveCount(
      1,
    )
    await authorizationStatus.selectOption('authorized_third_party')
    await reviewPrototypeForm
      .getByLabel('Authorization evidence (optional)', { exact: true })
      .fill('Synthetic, non-production authorization evidence.')
    const authorizedPrototype = await submitCommand(page, reviewPrototypeForm)
    expect(authorizedPrototype.stableId).toBe(prototypeDraft.stableId)
    expect(authorizedPrototype.lockVersion).toBe(prototypeDraft.lockVersion + 1)
    successfulOperationIds.push(authorizedPrototype.operationId)

    await fillVersionedCommand(
      reviewPrototypeForm,
      authorizedPrototype.stableId,
      authorizedPrototype.lockVersion,
      'Mark the fully qualified synthetic prototype eligible.',
    )
    await reviewPrototypeForm
      .getByLabel('Review decision type', { exact: true })
      .selectOption('reviewPrototypeInclusion')
    await reviewPrototypeForm
      .getByLabel('Inclusion status', { exact: true })
      .selectOption('eligible')
    const eligiblePrototype = await submitCommand(page, reviewPrototypeForm)
    expect(eligiblePrototype.stableId).toBe(prototypeDraft.stableId)
    expect(eligiblePrototype.lockVersion).toBe(authorizedPrototype.lockVersion + 1)
    successfulOperationIds.push(eligiblePrototype.operationId)

    await expectCatalogListItem(page, 'works', workName)
    const workCell = page.getByText(workName, { exact: true }).first()
    const workLink = workCell.locator('xpath=ancestor-or-self::a[1]')
    const workDocumentHref = await workLink.getAttribute('href')
    expect(workDocumentHref).toMatch(/^\/admin\/collections\/works\/[^/]+$/)
    const workDocumentId = workDocumentHref?.split('/').at(-1)
    expect(workDocumentId).toBeTruthy()
    await workLink.click()
    await expect(page.locator('input[name="displayName"]')).toHaveValue(workName)
    expect(
      await page.locator('input[name="displayName"]').evaluate((input) => {
        const element = input as HTMLInputElement
        return element.disabled || element.readOnly
      }),
    ).toBe(true)
    const saveButtons = page.getByRole('button', { name: /^save/i })
    if ((await saveButtons.count()) > 0) await expect(saveButtons.first()).toBeDisabled()

    const genericWriteStatuses = await page.evaluate(
      async ({ documentId, rejectedName }) => {
        const headers = { 'content-type': 'application/json' }
        const create = await fetch('/api/works', {
          body: JSON.stringify({ displayName: rejectedName }),
          credentials: 'same-origin',
          headers,
          method: 'POST',
        })
        const update = await fetch(`/api/works/${encodeURIComponent(documentId)}`, {
          body: JSON.stringify({ displayName: rejectedName }),
          credentials: 'same-origin',
          headers,
          method: 'PATCH',
        })
        const graphQL = await fetch('/api/graphql', {
          body: JSON.stringify({
            query: `mutation { createWork(data: { displayName: "${rejectedName}" }) { stableId } }`,
          }),
          credentials: 'same-origin',
          headers,
          method: 'POST',
        })
        return {
          create: create.status,
          graphQLBody: await graphQL.json(),
          graphQLStatus: graphQL.status,
          update: update.status,
        }
      },
      { documentId: workDocumentId!, rejectedName: `Rejected Generic Write ${marker}` },
    )
    expect(genericWriteStatuses.create).toBe(403)
    expect(genericWriteStatuses.update).toBe(403)
    expect([200, 400]).toContain(genericWriteStatuses.graphQLStatus)
    expect(genericWriteStatuses.graphQLBody).toHaveProperty('errors')

    await page.goto('/admin/collections/works')
    await expect(page.getByRole('link', { name: /create new/i })).toHaveCount(0)
    await expectCatalogListItem(page, 'manufacturers', manufacturerName)
    await expectCatalogListItem(page, 'characters', characterName)
    await expectCatalogListItem(page, 'character-aliases', characterAlias)
    await expectCatalogListItem(page, 'figure-prototypes', prototypeName)
    await expectCatalogListItem(page, 'figure-versions', versionName)

    await page.goto('/admin/collections/figure-prototype-characters')
    await expect(page.getByText(prototypeName, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(characterName, { exact: true }).first()).toBeVisible()

    await page.goto('/admin/collections/operation-logs')
    for (const operationId of successfulOperationIds) {
      await expect(page.getByText(operationId, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText('reviewPrototypeInclusion', { exact: true }).first()).toBeVisible()

    await page.goto('/admin/catalog-operations')
    const publicationForm = page.getByTestId('figure-prototype-lifecycle-form')
    await fillVersionedCommand(
      publicationForm,
      eligiblePrototype.stableId,
      eligiblePrototype.lockVersion,
      'Verify that PR-04 main-image capability still blocks publication.',
    )
    await publicationForm
      .getByLabel('Action', { exact: true })
      .selectOption('setPrototypePublicationStatus')
    await publicationForm
      .getByLabel('Publication status', { exact: true })
      .selectOption('published')
    const rejectedOperationId = (await page.getByTestId('catalog-operation-id').innerText()).trim()
    await publicationForm.locator('button[type="submit"]').click()
    await expect(page.getByTestId('catalog-command-error-code')).toHaveText(
      'FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE',
    )
    await expect(page.getByTestId('catalog-operation-id')).toHaveText(rejectedOperationId)

    await page.goto('/admin/collections/operation-logs')
    await expect(page.getByText(rejectedOperationId, { exact: true })).toHaveCount(0)
    assertNoExternalRequests()
  })
})
