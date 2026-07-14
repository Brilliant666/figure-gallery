import React from 'react'
import Link from 'next/link'
import { DomainOperationsClient } from './DomainOperationsClient'

const managed = [
  'Work',
  'Character / aliases',
  'Manufacturer status',
  'FigurePrototype',
  'FigureVersion',
  'Source invalidation',
  'CandidateRecord',
  'CandidateImage',
  'SystemSetting',
  'ReviewWorkItem',
  'OperationLog',
  'merge / split / specified undo',
  'hide / restore / manual main image',
]

export const DomainOperationsView = () => (
  <main data-testid="domain-operations-view" style={{ margin: '2rem', maxWidth: '72rem' }}>
    <h1>Audited domain operations</h1>
    <p>
      This disposable VAL-02B control surface documents the only supported write boundary. Every
      command posts to an administrator-only domain endpoint; generic Payload CRUD stays closed.
    </p>
    <ul>{managed.map((label) => <li key={label}>{label}</li>)}</ul>
    <section aria-label="Audited commands" data-endpoint="/api/operation-logs/domain-action" data-testid="audited-domain-commands">
      <h2>Commands</h2>
      <p>Open/reopen review, maintain allowlisted fields, invalidate source, hide/restore entries, select main image, merge, split and undo by operation ID.</p>
      <p>All mutations require an audit reason and create an append-only OperationLog in the same transaction.</p>
    </section>
    <DomainOperationsClient />
    <p><Link href="/admin/candidate-review">Open candidate review and manual main-image controls</Link></p>
  </main>
)
