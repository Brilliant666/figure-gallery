export const REM_V1_CONSOLIDATION_VERSION = 'rem-v1-consolidation-2026-08-10'

export const REM_V1_AUDIT_PROVENANCE = Object.freeze({
  pullRequest: 22,
  head: 'c08aeca42eabb0b0d7f3d808741f74a2a3262a8a',
  proposalSha256: 'ffc4ff447b5a1f3d1fb47281e24a224059199dd74a59e55e3e89af4787619d60',
})

function member(baselinePrototypeId, anchorCatalogItemId) {
  return Object.freeze({ baselinePrototypeId, anchorCatalogItemId })
}

function mergeGroup(proposalId, reasonType, members) {
  const baselineIds = members.map((value) => value.baselinePrototypeId).sort()
  return Object.freeze({
    proposalId,
    reasonType,
    survivorPrototypeId: baselineIds[0],
    members: Object.freeze(members),
  })
}

function differentRelation(candidateId, left, right) {
  return Object.freeze({ candidateId, left: Object.freeze(left), right: Object.freeze(right) })
}

export const REM_V1_MERGE_GROUPS = Object.freeze([
  mergeGroup('proposal-bicute-base-blue-white-pearl', 'PURE_COLOR_VARIANT', [
    member('rem-proto-0688416d8ef1f378', 'solaris:6672438919211'),
    member('rem-proto-a310c242726e5726', 'solaris:7229560487979'),
    member('rem-proto-b0250a3eb8e1c264', 'solaris:6937039863851'),
  ]),
  mergeGroup('proposal-birthday-lingerie-colors', 'PURE_COLOR_VARIANT', [
    member('rem-proto-023dfed31cb33603', 'solaris:7200405618731'),
    member('rem-proto-68a281869f603b9d', 'goodsmile:6505'),
    member('rem-proto-9ce25921631eefff', 'solaris:4319620235307'),
  ]),
  mergeGroup('proposal-oni-tenshi-listings', 'DUPLICATE_LISTING', [
    member('rem-proto-2bb1087db6b8de1e', 'solaris:2272066830393'),
    member('rem-proto-2e3a5b1e009acd52', 'solaris:7217892622379'),
    member('rem-proto-6f4e152cfc551f3c', 'solaris:4378375880747'),
  ]),
  mergeGroup('proposal-original-winter-winter-bunny', 'MINOR_EXPRESSION_ACCESSORY', [
    member('rem-proto-6446ba77f0fee392', 'solaris:6847337857067'),
    member('rem-proto-b51f231b7aa14d8e', 'solaris:7279181365291'),
  ]),
  mergeGroup('proposal-kunoichi-listings', 'DUPLICATE_LISTING', [
    member('rem-proto-2f175e77fcde82c3', 'solaris:6629944131627'),
    member('rem-proto-8dd74e43d10ebdc0', 'solaris:4458391732267'),
  ]),
  mergeGroup('proposal-yukata-repaint-renewal', 'RERELEASE_RENEWAL', [
    member('rem-proto-47dd45a7e14e789d', 'solaris:4112876994603'),
    member('rem-proto-b22937098c30e8a8', 'goodsmile:1136861'),
  ]),
  mergeGroup('proposal-cheerleader-channel-variant', 'CHANNEL_VARIANT', [
    member('rem-proto-39a995d0d02960df', 'solaris:6943217975339'),
    member('rem-proto-c585521bcf854295', 'solaris:6606169440299'),
  ]),
])

export const REM_V1_DIFFERENT_RELATIONS = Object.freeze([
  differentRelation('residual-pair-001', member('rem-proto-0ee4971ae19a0c17', 'solaris:4802786197547'), member('rem-proto-52719e75b9e597a7', 'solaris:7097079988267')),
  differentRelation('residual-pair-002', member('rem-proto-15d3cfe3b58b56ec', 'solaris:7260065005611'), member('rem-proto-c9333f6a2704b288', 'solaris:7348122058795')),
  differentRelation('residual-pair-003', member('rem-proto-5a66157113a6900c', 'goodsmile:12410'), member('rem-proto-ae12b9c19564fd63', 'goodsmile:9227')),
  differentRelation('residual-pair-004', member('rem-proto-5b1d87fbc80ff558', 'solaris:6956376326187'), member('rem-proto-ce4d010483ff22be', 'solaris:7069309501483')),
  differentRelation('residual-pair-005', member('rem-proto-63e4fd3cb007c40c', 'solaris:10466333064'), member('rem-proto-80ae6729c78ab85c', 'solaris:10466331400')),
  differentRelation('residual-pair-006', member('rem-proto-7a1d96fd77a46066', 'solaris:7200655802411'), member('rem-proto-f35d0fbac96ac98e', 'solaris:7200658358315')),
  differentRelation('residual-pair-007', member('rem-proto-7a6dcc936b8c8dd5', 'solaris:6847330091051'), member('rem-proto-91a1f4db9d742fae', 'solaris:1531066220601')),
  differentRelation('residual-pair-008', member('rem-proto-a310c242726e5726', 'solaris:7229560487979'), member('rem-proto-afea5fc78039d0b4', 'solaris:7434732830763')),
  differentRelation('residual-pair-010', member('rem-proto-afea5fc78039d0b4', 'solaris:7434732830763'), member('rem-proto-b0250a3eb8e1c264', 'solaris:6937039863851')),
  differentRelation('residual-pair-020', member('rem-proto-11ff96261dcaff3c', 'solaris:7284897546283'), member('rem-proto-33db28e4c5e56a3a', 'solaris:7284897382443')),
  differentRelation('residual-pair-022', member('rem-proto-08c1c6dbd86281b2', 'solaris:6611543162923'), member('rem-proto-583e1a497f66b836', 'solaris:6611542868011')),
  differentRelation('residual-pair-023', member('rem-proto-0033000a279ca9b0', 'solaris:6762679435307'), member('rem-proto-6446ba77f0fee392', 'solaris:6847337857067')),
  differentRelation('residual-pair-024', member('rem-proto-0acb42a062cb298a', 'solaris:6544847863851'), member('rem-proto-a5c0780ce5acfcc4', 'solaris:6779202076715')),
  differentRelation('residual-pair-025', member('rem-proto-5b007749f4ca6406', 'solaris:4854627172395'), member('rem-proto-c2965e11b325f881', 'solaris:7354315767851')),
  differentRelation('residual-pair-026', member('rem-proto-0acb42a062cb298a', 'solaris:6544847863851'), member('rem-proto-c585521bcf854295', 'solaris:6606169440299')),
  differentRelation('residual-pair-027', member('rem-proto-173898f6784b4e1e', 'solaris:6606163083307'), member('rem-proto-9d97386e4a5e87f2', 'solaris:6562234957867')),
  differentRelation('residual-pair-028', member('rem-proto-0033000a279ca9b0', 'solaris:6762679435307'), member('rem-proto-b51f231b7aa14d8e', 'solaris:7279181365291')),
  differentRelation('residual-pair-029', member('rem-proto-57755ad602a8fd95', 'goodsmile:10907'), member('rem-proto-c314e7aca79152dc', 'solaris:7283597901867')),
  differentRelation('residual-pair-030', member('rem-proto-80deed6d29562934', 'solaris:6545280335915'), member('rem-proto-b7c333313aa3e396', 'solaris:7241224060971')),
  differentRelation('residual-pair-031', member('rem-proto-08198fdfc8fc85e5', 'solaris:4840386297899'), member('rem-proto-7f391153feaede96', 'solaris:7096746704939')),
  differentRelation('residual-pair-032', member('rem-proto-b4974c6793d935ba', 'goodsmile:1137281'), member('rem-proto-f9f55df51821274f', 'goodsmile:10783')),
  differentRelation('residual-pair-033', member('rem-proto-5b1d87fbc80ff558', 'solaris:6956376326187'), member('rem-proto-75d95d01144e388b', 'solaris:6730248716331')),
  differentRelation('residual-pair-034', member('rem-proto-75d95d01144e388b', 'solaris:6730248716331'), member('rem-proto-ce4d010483ff22be', 'solaris:7069309501483')),
  differentRelation('residual-pair-035', member('rem-proto-5f82f602529ebfba', 'goodsmile:9684'), member('rem-proto-d3ce18687c805fe8', 'goodsmile:6929')),
])

export const REM_V1_EXPECTED = Object.freeze({
  beforePrototypeCount: 231,
  mergeGroups: 7,
  prototypeCardsAffected: 17,
  retiredPrototypeIds: 10,
  afterPrototypeCount: 221,
  differentRelations: 24,
})

export const REM_V1_ALIASES = Object.freeze(Object.fromEntries(
  REM_V1_MERGE_GROUPS.flatMap((group) => group.members
    .map((value) => value.baselinePrototypeId)
    .filter((prototypeId) => prototypeId !== group.survivorPrototypeId)
    .map((prototypeId) => [prototypeId, group.survivorPrototypeId])),
))
