import { randomUUID } from 'node:crypto'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { CatalogOperationsClient } from './CatalogOperationsClient'
import styles from './catalog.module.css'

export async function CatalogOperationsView(props: AdminViewServerProps) {
  const { initPageResult, params, payload, searchParams } = props
  const { req } = initPageResult
  const adminRoute = payload.config.routes.admin
  const currentPath = formatAdminURL({ adminRoute, path: '/catalog-operations' })

  if (!req.user) {
    const loginPath = formatAdminURL({
      adminRoute,
      path: payload.config.admin.routes.login,
    })

    redirect(`${loginPath}?redirect=${encodeURIComponent(currentPath)}`)
  }

  if (req.user.collection !== payload.config.admin.user) {
    return (
      <main className={styles.accessDenied} data-testid="catalog-operations-access-denied">
        <h1>Catalog Operations</h1>
        <p role="alert">This view is restricted to authenticated catalog administrators.</p>
      </main>
    )
  }

  return (
    <DefaultTemplate
      i18n={props.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={payload}
      permissions={initPageResult.permissions}
      req={req}
      searchParams={searchParams}
      user={req.user}
      viewType="catalogOperations"
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <CatalogOperationsClient initialOperationId={randomUUID()} />
      </Gutter>
    </DefaultTemplate>
  )
}
