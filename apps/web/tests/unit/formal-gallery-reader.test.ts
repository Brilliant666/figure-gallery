import {
  buildGalleryParityQueries,
  compareGalleryReadModels,
  filterGalleryProducts,
  galleryManufacturerOptions,
  galleryTypeOptions,
} from '@figure-gallery/gallery-read-model'
import {
  buildMembershipFingerprint,
  buildSourceRecordBusinessDigest,
  buildSourceRecordKey,
  createFormalBridgeBundle,
  type FormalBridgeCatalogItem,
  type FormalBridgeSemanticBundle,
  type FormalBridgeSourceRecord,
} from '@/formal-bridge/export'
import { buildFormalGalleryReadModelFromBundle } from '@/formal-gallery/reader'
import { describe, expect, it } from 'vitest'

function sourceRecord(
  catalogItemKey: string,
  sourceUrl: string,
  sourceFamily: FormalBridgeSourceRecord['sourceFamily'],
): FormalBridgeSourceRecord {
  const value: Omit<FormalBridgeSourceRecord, 'businessDigest'> = {
    businessDigestVersion: 1,
    catalogItemKey,
    characterKey: 'rem',
    observedManufacturer: null,
    observedTitle: null,
    sourceFamily,
    sourceLabel: sourceFamily === 'goodsmile' ? 'Good Smile' : 'Solaris Japan',
    sourceRecordKey: buildSourceRecordKey(sourceFamily, sourceUrl),
    sourceRole: sourceFamily === 'goodsmile' ? 'official' : 'catalog/retailer source',
    sourceUrl,
  }
  return { ...value, businessDigest: buildSourceRecordBusinessDigest(value) }
}

function catalogItem(
  catalogItemKey: string,
  prototypeKey: string,
  title: string,
  manufacturerText: string,
  imageUrls: string[],
  sourceFamily: 'goodsmile' | 'solaris',
): FormalBridgeCatalogItem {
  return {
    catalogItemKey,
    category: sourceFamily === 'goodsmile' ? '1/7th Scale' : 'Prize',
    characterKey: 'rem',
    classification: sourceFamily === 'goodsmile' ? 'likely_scale' : 'likely_prize',
    description: null,
    heightMm: null,
    imageRefs: imageUrls.map((url, index) => ({
      catalogItemKey,
      imageRefKey: `image-ref-${catalogItemKey.replaceAll(':', '-')}-${index}`,
      isMain: index === 0,
      sourceFamily,
      url,
    })),
    manufacturerText,
    productType: 'Figure',
    prototypeKey,
    release: null,
    scale: sourceFamily === 'goodsmile' ? '1/7' : null,
    series: 'Re:ZERO',
    title,
  }
}

function semanticBundle(): FormalBridgeSemanticBundle {
  const richKey = 'rem-proto-rich'
  const sparseKey = 'rem-proto-sparse'
  const richItems = [
    catalogItem(
      'goodsmile:1',
      richKey,
      'Rem Renewal',
      'Good Smile Company',
      [
        'https://images.goodsmile.info/example/rem-main.jpg',
        'https://images.goodsmile.info/example/rem-side.jpg',
      ],
      'goodsmile',
    ),
    catalogItem(
      'solaris:1',
      richKey,
      'Rem Original',
      'Good Smile Company',
      ['https://cdn.shopify.com/s/files/1/0318/2649/rem-original.jpg'],
      'solaris',
    ),
  ]
  const sparseItem = catalogItem(
    'solaris:2',
    sparseKey,
    'Rem Prize',
    'FuRyu',
    ['https://cdn.shopify.com/s/files/1/0318/2649/rem-prize.jpg'],
    'solaris',
  )
  return {
    catalogItems: [sparseItem, ...richItems],
    characters: [
      { aliases: ['Rem', 'レム', '蕾姆'], characterKey: 'rem', displayName: '蕾姆', slug: 'rem' },
    ],
    figurePrototypes: [
      {
        catalogItemKeys: [sparseItem.catalogItemKey],
        characterKey: 'rem',
        figureType: 'prize',
        isGroup: false,
        membershipFingerprint: buildMembershipFingerprint([sparseItem.catalogItemKey]),
        projectionKey: sparseKey,
        scale: null,
        title: sparseItem.title,
      },
      {
        catalogItemKeys: richItems.map((item) => item.catalogItemKey),
        characterKey: 'rem',
        figureType: 'scale',
        isGroup: false,
        membershipFingerprint: buildMembershipFingerprint(
          richItems.map((item) => item.catalogItemKey),
        ),
        projectionKey: richKey,
        scale: '1/7',
        title: 'Rem Original',
      },
    ],
    schemaVersion: 1,
    sourceRecords: [
      sourceRecord('goodsmile:1', 'https://www.goodsmile.com/en/product/1', 'goodsmile'),
      sourceRecord('solaris:1', 'https://solarisjapan.com/products/rem-original', 'solaris'),
      sourceRecord('solaris:2', 'https://solarisjapan.com/products/rem-prize', 'solaris'),
    ],
  }
}

describe('formal Gallery reader', () => {
  it('projects formal Payload readback into the shared recommendation and detail model', () => {
    const model = buildFormalGalleryReadModelFromBundle(
      createFormalBridgeBundle(semanticBundle()),
      'rem',
    )

    expect(model.products.map((product: { id: string }) => product.id)).toEqual([
      'rem-proto-rich',
      'rem-proto-sparse',
    ])
    expect(model.products[0].catalogItems).toHaveLength(2)
    expect(model.products[0].images).toHaveLength(3)
    expect(model.products[0].coverImage?.url).toBe(
      'https://images.goodsmile.info/example/rem-main.jpg',
    )
    expect(model.products[0].sources.map((source: { label: string }) => source.label)).toEqual([
      'Good Smile',
      'Solaris Japan',
    ])
    expect(model.summary).toMatchObject({
      catalogItemCount: 3,
      imageCount: 4,
      prototypeCount: 2,
      prototypeWithImageCount: 2,
    })
  })

  it('uses one search/filter/options implementation for Local and Formal consumers', () => {
    const model = buildFormalGalleryReadModelFromBundle(
      createFormalBridgeBundle(semanticBundle()),
      'rem',
    )

    expect(
      filterGalleryProducts(model.products, { search: 'Renewal' }).map((item) => item.id),
    ).toEqual(['rem-proto-rich'])
    expect(
      filterGalleryProducts(model.products, { manufacturer: 'FuRyu' }).map((item) => item.id),
    ).toEqual(['rem-proto-sparse'])
    expect(galleryManufacturerOptions(model.products)).toEqual(['FuRyu', 'Good Smile Company'])
    expect(galleryTypeOptions(model.products)).toEqual(['likely_prize', 'likely_scale'])
    expect(buildGalleryParityQueries(model)).toContain('蕾姆')
  })

  it('compares complete card/detail, order, search, and filter semantics', () => {
    const local = buildFormalGalleryReadModelFromBundle(
      createFormalBridgeBundle(semanticBundle()),
      'rem',
      {
        preferences: {
          excludedProductIds: ['rem-proto-sparse'],
          products: { 'rem-proto-rich': { manualNote: 'keep this pose' } },
        },
      },
    )
    const equalResult = compareGalleryReadModels(local, structuredClone(local))
    expect(equalResult).toMatchObject({ matched: true, mismatchCount: 0 })

    const changed = structuredClone(local)
    changed.products[0].catalogItems[0].title = 'Changed title'
    const changedResult = compareGalleryReadModels(local, changed)
    expect(changedResult.matched).toBe(false)
    expect(changedResult.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'card-and-detail',
          prototypeId: 'rem-proto-rich',
          scope: 'prototype',
        }),
      ]),
    )
  })
})
