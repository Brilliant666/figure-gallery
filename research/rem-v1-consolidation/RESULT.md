# Rem v1 consolidation result

Date: 2026-08-10

All seven approved PR #22 merge proposals were applied to the product-owned Rem projection contract. They affected 17 existing cards and retired 10 duplicate IDs, reducing the gallery from 231 to 221 prototypes while retaining all 284 projection-eligible Catalog Items. The final shape is 175 singleton prototypes, 46 multi-item prototypes, and a largest group size of four. All 24 confirmed DIFFERENT relations remain separate and grouping conflicts are zero.

Prototype identity is now independent of the current membership hash. The 214 unaffected IDs remain unchanged; each merged group retains one deterministic existing survivor ID, producing 10 retired-to-survivor aliases and no new IDs. The complete membership is stored separately as `membershipFingerprint`. Two consecutive rebuilds produced zero prototype ID drift, zero fingerprint drift, and zero top-50 order drift. Retired detail URLs resolve to the survivor.

The existing Rem preferences did not target any affected prototype, so actual cover, exclusion, and note migrations were all zero and no backup write was necessary. The migration implementation still covers survivor preference priority, valid retired cover migration, all/mixed exclusion handling, note preservation, conflict reporting, one-time backup, retired-key removal, and idempotent reruns. The existing manual cover on an unaffected prototype remained selected across a Chrome reload.

The default order is now **推荐**, meaning reference-data completeness rather than popularity. It sorts by cover availability, image-count bucket, source-family count, Good Smile enrichment, normalized title, and prototype ID. The first 50 cards all have covers and at least eight image references, averaging 14.4 references versus 3.14 for the remaining cards. No popularity or Latest label, score, or behavior was introduced.

The final gallery contains 221 cards, 220 covers, and 1,257 ImageRefs. The one source item without images remains an explicit `暂无可用图片` card. Both Relax Time provenance cases remain separate because the frozen evidence is inconclusive. A complete system-Chrome scan of all 221 cards found no new obvious same-pose color or rerelease duplicate candidate. All seven merged groups retained their Catalog Items, images, and source links.

Rem v1 can be frozen: **YES**.

The only recommended next step is to freeze this Rem v1 baseline and use the same stable-identity and recommendation contracts when validating another character, without reopening Rem grouping research.
