import { Link } from '@payloadcms/ui'
import type { Payload } from 'payload'
import { formatAdminURL } from 'payload/shared'

import styles from './catalog.module.css'

type CatalogOperationsNavLinkProps = {
  payload: Payload
}

export function CatalogOperationsNavLink({ payload }: CatalogOperationsNavLinkProps) {
  const href = formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: '/catalog-operations',
  })

  return (
    <Link
      aria-label="Open Catalog Operations"
      className={styles.navLink}
      data-testid="catalog-operations-nav-link"
      href={href}
    >
      Catalog Operations
    </Link>
  )
}
