import type {
  CatalogCommand,
  CatalogCommandResult,
  PrototypeCharacterCommandInput,
} from "@figure-gallery/domain-contracts";

export const CATALOG_FIXTURE_ROOT_KEYS = [
  "workAurora",
  "workFrontier",
  "characterAsterAurora",
  "characterAsterFrontier",
  "characterNila",
  "characterOrin",
  "manufacturerActive",
  "manufacturerHidden",
  "manufacturerDraft",
  "prototypeSolarArcA",
  "prototypeSolarArcB",
  "prototypeGroup",
  "prototypeThirdParty",
  "prototypeRejected",
  "versionRegular",
  "versionDeluxe",
  "versionReissue",
  "versionRecolor",
  "versionPartialGray",
  "versionGroupRegular",
  "versionCompleteGray",
] as const;

export const CATALOG_FIXTURE_ALIAS_KEYS = [
  "aliasAsterAuroraZh",
  "aliasAsterAuroraJa",
  "aliasAsterFrontierZh",
  "aliasNilaJa",
  "aliasOrinEn",
] as const;

export const CATALOG_FIXTURE_ENTITY_KEYS = [
  ...CATALOG_FIXTURE_ROOT_KEYS,
  ...CATALOG_FIXTURE_ALIAS_KEYS,
] as const;

export type CatalogFixtureRootKey = (typeof CATALOG_FIXTURE_ROOT_KEYS)[number];
export type CatalogFixtureAliasKey =
  (typeof CATALOG_FIXTURE_ALIAS_KEYS)[number];
export type CatalogFixtureEntityKey =
  (typeof CATALOG_FIXTURE_ENTITY_KEYS)[number];

type FixtureExecution =
  | CatalogCommandResult
  | {
      replayed: boolean;
      result: CatalogCommandResult;
    };

export type CatalogFixtureExecutor = (
  command: CatalogCommand,
) => Promise<FixtureExecution>;

type PlanContext = {
  result: (key: CatalogFixtureRootKey) => CatalogCommandResult;
  stableId: (key: CatalogFixtureEntityKey) => string;
};

export type CatalogFixturePlanStep = {
  build: (context: PlanContext) => CatalogCommand;
  key: string;
  operationId: string;
  relatedStableKey?: CatalogFixtureAliasKey;
  resultKey: CatalogFixtureRootKey;
};

export type CatalogFixtureSeedResult = {
  commands: readonly CatalogCommand[];
  replayedOperations: number;
  results: Readonly<Record<CatalogFixtureRootKey, CatalogCommandResult>>;
  stableIds: Readonly<Record<CatalogFixtureEntityKey, string>>;
};

function operationId(sequence: number): string {
  return `71000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function reason(action: string): string {
  return `Synthetic PR-01 fixture: ${action}.`;
}

function step(
  input: Omit<CatalogFixturePlanStep, "operationId">,
  sequence: number,
) {
  return {
    ...input,
    operationId: operationId(sequence),
  } satisfies CatalogFixturePlanStep;
}

function versioned(
  context: PlanContext,
  key: CatalogFixtureRootKey,
): Pick<CatalogCommandResult, "lockVersion" | "stableId"> {
  const result = context.result(key);
  return { lockVersion: result.lockVersion, stableId: result.stableId };
}

function characterRelation(
  context: PlanContext,
  key: CatalogFixtureRootKey,
  displayOrder: number,
  role: PrototypeCharacterCommandInput["role"],
): PrototypeCharacterCommandInput {
  return {
    characterStableId: context.stableId(key),
    displayOrder,
    role,
  };
}

export const CATALOG_FIXTURE_COMMAND_PLAN: readonly CatalogFixturePlanStep[] = [
  step(
    {
      key: "create-work-aurora",
      resultKey: "workAurora",
      build: () => ({
        displayName: "Clockwork Aurora",
        operationId: operationId(1),
        originalName: "Clockwork Aurora Origin",
        reason: reason("create the first fictional work"),
        type: "createWork",
        workType: "animation",
      }),
    },
    1,
  ),
  step(
    {
      key: "publish-work-aurora",
      resultKey: "workAurora",
      build: (context) => {
        const current = versioned(context, "workAurora");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(2),
          publicationStatus: "published",
          reason: reason("publish the first fictional work"),
          stableId: current.stableId,
          type: "setWorkPublicationStatus",
        };
      },
    },
    2,
  ),
  step(
    {
      key: "create-work-frontier",
      resultKey: "workFrontier",
      build: () => ({
        displayName: "Lattice Frontier",
        operationId: operationId(3),
        originalName: "Lattice Frontier Origin",
        reason: reason("create the second fictional work"),
        type: "createWork",
        workType: "game",
      }),
    },
    3,
  ),
  step(
    {
      key: "create-character-aster-aurora",
      resultKey: "characterAsterAurora",
      build: (context) => ({
        displayName: "Aster Vale",
        nameEn: "Aster Vale",
        nameJa: "アステル・ヴェイルA",
        nameZh: "星谷甲",
        operationId: operationId(4),
        reason: reason("create the first same-name fictional character"),
        type: "createCharacter",
        workStableId: context.stableId("workAurora"),
      }),
    },
    4,
  ),
  step(
    {
      key: "activate-character-aster-aurora",
      resultKey: "characterAsterAurora",
      build: (context) => {
        const current = versioned(context, "characterAsterAurora");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(5),
          reason: reason("activate the first same-name fictional character"),
          stableId: current.stableId,
          status: "active",
          type: "setCharacterStatus",
        };
      },
    },
    5,
  ),
  step(
    {
      key: "alias-character-aster-aurora-zh",
      relatedStableKey: "aliasAsterAuroraZh",
      resultKey: "characterAsterAurora",
      build: (context) => {
        const current = versioned(context, "characterAsterAurora");
        return {
          aliasType: "translation",
          expectedVersion: current.lockVersion,
          isPreferred: true,
          locale: "zh-CN",
          operationId: operationId(6),
          reason: reason(
            "add a Chinese alias to the first same-name character",
          ),
          stableId: current.stableId,
          type: "addCharacterAlias",
          value: "星谷甲",
        };
      },
    },
    6,
  ),
  step(
    {
      key: "alias-character-aster-aurora-ja",
      relatedStableKey: "aliasAsterAuroraJa",
      resultKey: "characterAsterAurora",
      build: (context) => {
        const current = versioned(context, "characterAsterAurora");
        return {
          aliasType: "official",
          expectedVersion: current.lockVersion,
          isPreferred: true,
          locale: "ja",
          operationId: operationId(7),
          reason: reason(
            "add a Japanese alias to the first same-name character",
          ),
          stableId: current.stableId,
          type: "addCharacterAlias",
          value: "アステル甲",
        };
      },
    },
    7,
  ),
  step(
    {
      key: "create-character-aster-frontier",
      resultKey: "characterAsterFrontier",
      build: (context) => ({
        displayName: "Aster Vale",
        nameEn: "Aster Vale",
        nameJa: "アステル・ヴェイルB",
        nameZh: "星谷乙",
        operationId: operationId(8),
        reason: reason("create the second same-name fictional character"),
        type: "createCharacter",
        workStableId: context.stableId("workFrontier"),
      }),
    },
    8,
  ),
  step(
    {
      key: "activate-character-aster-frontier",
      resultKey: "characterAsterFrontier",
      build: (context) => {
        const current = versioned(context, "characterAsterFrontier");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(9),
          reason: reason("activate the second same-name fictional character"),
          stableId: current.stableId,
          status: "active",
          type: "setCharacterStatus",
        };
      },
    },
    9,
  ),
  step(
    {
      key: "alias-character-aster-frontier-zh",
      relatedStableKey: "aliasAsterFrontierZh",
      resultKey: "characterAsterFrontier",
      build: (context) => {
        const current = versioned(context, "characterAsterFrontier");
        return {
          aliasType: "translation",
          expectedVersion: current.lockVersion,
          isPreferred: true,
          locale: "zh-CN",
          operationId: operationId(10),
          reason: reason(
            "add a Chinese alias to the second same-name character",
          ),
          stableId: current.stableId,
          type: "addCharacterAlias",
          value: "星谷乙",
        };
      },
    },
    10,
  ),
  step(
    {
      key: "create-character-nila",
      resultKey: "characterNila",
      build: (context) => ({
        displayName: "Nila Quill",
        nameEn: "Nila Quill",
        nameJa: "ニラ・クイル",
        nameZh: "妮拉羽笔",
        operationId: operationId(11),
        reason: reason("create the third fictional character"),
        type: "createCharacter",
        workStableId: context.stableId("workAurora"),
      }),
    },
    11,
  ),
  step(
    {
      key: "activate-character-nila",
      resultKey: "characterNila",
      build: (context) => {
        const current = versioned(context, "characterNila");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(12),
          reason: reason("activate the third fictional character"),
          stableId: current.stableId,
          status: "active",
          type: "setCharacterStatus",
        };
      },
    },
    12,
  ),
  step(
    {
      key: "alias-character-nila-ja",
      relatedStableKey: "aliasNilaJa",
      resultKey: "characterNila",
      build: (context) => {
        const current = versioned(context, "characterNila");
        return {
          aliasType: "romanization",
          expectedVersion: current.lockVersion,
          isPreferred: true,
          locale: "ja-Latn",
          operationId: operationId(13),
          reason: reason(
            "add a romanized alias to the third fictional character",
          ),
          stableId: current.stableId,
          type: "addCharacterAlias",
          value: "Nira Kuiru",
        };
      },
    },
    13,
  ),
  step(
    {
      key: "create-character-orin",
      resultKey: "characterOrin",
      build: () => ({
        displayName: "Orin Mesh",
        nameEn: "Orin Mesh",
        nameJa: "オリン・メッシュ",
        nameZh: "奥林织格",
        operationId: operationId(14),
        reason: reason("create a fictional character without a work"),
        type: "createCharacter",
      }),
    },
    14,
  ),
  step(
    {
      key: "activate-character-orin",
      resultKey: "characterOrin",
      build: (context) => {
        const current = versioned(context, "characterOrin");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(15),
          reason: reason("activate the fictional character without a work"),
          stableId: current.stableId,
          status: "active",
          type: "setCharacterStatus",
        };
      },
    },
    15,
  ),
  step(
    {
      key: "alias-character-orin-en",
      relatedStableKey: "aliasOrinEn",
      resultKey: "characterOrin",
      build: (context) => {
        const current = versioned(context, "characterOrin");
        return {
          aliasType: "common",
          expectedVersion: current.lockVersion,
          isPreferred: true,
          locale: "en",
          operationId: operationId(16),
          reason: reason(
            "add an English alias to the fourth fictional character",
          ),
          stableId: current.stableId,
          type: "addCharacterAlias",
          value: "Meshwalker",
        };
      },
    },
    16,
  ),
  step(
    {
      key: "create-manufacturer-active",
      resultKey: "manufacturerActive",
      build: () => ({
        aliases: [{ locale: "en", value: "Mosaic Lab" }],
        authorizationNote: "Synthetic authorization note.",
        canonicalName: "Mosaic Forge Lab",
        operationId: operationId(17),
        reason: reason("create the manufacturer that will become active"),
        sourceEvidence: {
          fixture: true,
          statement: "offline synthetic evidence",
        },
        type: "createManufacturer",
      }),
    },
    17,
  ),
  step(
    {
      key: "activate-manufacturer",
      resultKey: "manufacturerActive",
      build: (context) => {
        const current = versioned(context, "manufacturerActive");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(18),
          reason: reason("activate the first fictional manufacturer"),
          stableId: current.stableId,
          status: "active",
          type: "setManufacturerStatus",
        };
      },
    },
    18,
  ),
  step(
    {
      key: "create-manufacturer-hidden",
      resultKey: "manufacturerHidden",
      build: () => ({
        aliases: [{ locale: "en", value: "Orbit Workshop" }],
        canonicalName: "Synthetic Orbit Works",
        operationId: operationId(19),
        reason: reason("create the manufacturer that will become hidden"),
        sourceEvidence: {
          fixture: true,
          statement: "offline synthetic evidence",
        },
        type: "createManufacturer",
      }),
    },
    19,
  ),
  step(
    {
      key: "activate-manufacturer-before-hide",
      resultKey: "manufacturerHidden",
      build: (context) => {
        const current = versioned(context, "manufacturerHidden");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(20),
          reason: reason(
            "activate the second fictional manufacturer before hiding it",
          ),
          stableId: current.stableId,
          status: "active",
          type: "setManufacturerStatus",
        };
      },
    },
    20,
  ),
  step(
    {
      key: "hide-manufacturer",
      resultKey: "manufacturerHidden",
      build: (context) => {
        const current = versioned(context, "manufacturerHidden");
        return {
          expectedVersion: current.lockVersion,
          operationId: operationId(21),
          reason: reason("hide the second fictional manufacturer"),
          stableId: current.stableId,
          status: "hidden",
          type: "setManufacturerStatus",
        };
      },
    },
    21,
  ),
  step(
    {
      key: "create-manufacturer-draft",
      resultKey: "manufacturerDraft",
      build: () => ({
        aliases: [{ locale: "en", value: "Paper Meridian" }],
        canonicalName: "Paper Meridian Studio",
        operationId: operationId(22),
        reason: reason("create the manufacturer that remains draft"),
        sourceEvidence: {
          fixture: true,
          statement: "offline synthetic evidence",
        },
        type: "createManufacturer",
      }),
    },
    22,
  ),
  step(
    {
      key: "create-prototype-solar-a",
      resultKey: "prototypeSolarArcA",
      build: (context) => ({
        characters: [
          characterRelation(context, "characterAsterAurora", 0, "primary"),
        ],
        costumeText: "Prismatic field suit",
        figureType: "scale",
        isGroup: false,
        manufacturerStableId: context.stableId("manufacturerActive"),
        operationId: operationId(23),
        reason: reason("create the first same-title fictional prototype"),
        scale: "1/7",
        title: "Solar Arc Pose",
        type: "createFigurePrototype",
        workStableId: context.stableId("workAurora"),
      }),
    },
    23,
  ),
  step(
    {
      key: "authorize-prototype-solar-a",
      resultKey: "prototypeSolarArcA",
      build: (context) => {
        const current = versioned(context, "prototypeSolarArcA");
        return {
          authorizationEvidence: {
            fixture: true,
            statement: "synthetic official evidence",
          },
          authorizationStatus: "official",
          expectedVersion: current.lockVersion,
          operationId: operationId(24),
          reason: reason(
            "approve official authorization for the first prototype",
          ),
          stableId: current.stableId,
          type: "reviewPrototypeAuthorization",
        };
      },
    },
    24,
  ),
  step(
    {
      key: "create-version-regular",
      resultKey: "versionRegular",
      build: (context) => ({
        grayModelCompleteness: "not_applicable",
        kind: "regular",
        name: "Solar Arc Regular",
        operationId: operationId(25),
        prototypeStableId: context.stableId("prototypeSolarArcA"),
        reason: reason("create a regular fictional version"),
        releaseStatus: "released",
        type: "createFigureVersion",
      }),
    },
    25,
  ),
  step(
    {
      key: "create-version-deluxe",
      resultKey: "versionDeluxe",
      build: (context) => ({
        grayModelCompleteness: "not_applicable",
        kind: "deluxe",
        name: "Solar Arc Deluxe",
        operationId: operationId(26),
        prototypeStableId: context.stableId("prototypeSolarArcA"),
        reason: reason("create a deluxe fictional version"),
        releaseStatus: "preorder",
        type: "createFigureVersion",
      }),
    },
    26,
  ),
  step(
    {
      key: "create-version-reissue",
      resultKey: "versionReissue",
      build: (context) => ({
        grayModelCompleteness: "not_applicable",
        kind: "reissue",
        name: "Solar Arc Reissue",
        operationId: operationId(27),
        prototypeStableId: context.stableId("prototypeSolarArcA"),
        reason: reason("create a reissue fictional version"),
        releaseStatus: "announced",
        type: "createFigureVersion",
      }),
    },
    27,
  ),
  step(
    {
      key: "create-version-recolor",
      resultKey: "versionRecolor",
      build: (context) => ({
        grayModelCompleteness: "not_applicable",
        kind: "recolor",
        name: "Solar Arc Recolor",
        operationId: operationId(28),
        prototypeStableId: context.stableId("prototypeSolarArcA"),
        reason: reason("create a recolor fictional version"),
        releaseStatus: "painted_prototype",
        type: "createFigureVersion",
      }),
    },
    28,
  ),
  step(
    {
      key: "include-prototype-solar-a",
      resultKey: "prototypeSolarArcA",
      build: (context) => {
        const current = versioned(context, "prototypeSolarArcA");
        return {
          expectedVersion: current.lockVersion,
          inclusionStatus: "eligible",
          operationId: operationId(29),
          reason: reason("approve inclusion for the first prototype"),
          stableId: current.stableId,
          type: "reviewPrototypeInclusion",
        };
      },
    },
    29,
  ),
  step(
    {
      key: "create-prototype-solar-b",
      resultKey: "prototypeSolarArcB",
      build: (context) => ({
        characters: [
          characterRelation(context, "characterAsterFrontier", 0, "primary"),
        ],
        costumeText: "Geometric field suit",
        figureType: "prize",
        isGroup: false,
        manufacturerStableId: context.stableId("manufacturerHidden"),
        operationId: operationId(30),
        reason: reason("create the second same-title fictional prototype"),
        title: "  SOLAR   ARC POSE  ",
        type: "createFigurePrototype",
        workStableId: context.stableId("workFrontier"),
      }),
    },
    30,
  ),
  step(
    {
      key: "authorize-prototype-solar-b",
      resultKey: "prototypeSolarArcB",
      build: (context) => {
        const current = versioned(context, "prototypeSolarArcB");
        return {
          authorizationEvidence: {
            fixture: true,
            statement: "synthetic official evidence",
          },
          authorizationStatus: "official",
          expectedVersion: current.lockVersion,
          operationId: operationId(31),
          reason: reason(
            "approve authorization for the second same-title prototype",
          ),
          stableId: current.stableId,
          type: "reviewPrototypeAuthorization",
        };
      },
    },
    31,
  ),
  step(
    {
      key: "create-version-partial-gray",
      resultKey: "versionPartialGray",
      build: (context) => ({
        grayModelCompleteness: "partial",
        kind: "regular",
        name: "Solar Arc Partial Gray",
        operationId: operationId(32),
        prototypeStableId: context.stableId("prototypeSolarArcB"),
        reason: reason("create an incomplete gray fictional version"),
        releaseStatus: "gray_prototype",
        type: "createFigureVersion",
      }),
    },
    32,
  ),
  step(
    {
      key: "create-prototype-group",
      resultKey: "prototypeGroup",
      build: (context) => ({
        characters: [
          characterRelation(context, "characterNila", 0, "primary"),
          characterRelation(context, "characterOrin", 1, "secondary"),
        ],
        costumeText: "Paired signal uniforms",
        figureType: "scale",
        isGroup: true,
        manufacturerStableId: context.stableId("manufacturerActive"),
        operationId: operationId(33),
        reason: reason("create a multi-character fictional prototype"),
        scale: "1/8",
        title: "Twin Signal Stance",
        type: "createFigurePrototype",
        workStableId: context.stableId("workAurora"),
      }),
    },
    33,
  ),
  step(
    {
      key: "authorize-prototype-group",
      resultKey: "prototypeGroup",
      build: (context) => {
        const current = versioned(context, "prototypeGroup");
        return {
          authorizationEvidence: {
            fixture: true,
            statement: "synthetic official evidence",
          },
          authorizationStatus: "official",
          expectedVersion: current.lockVersion,
          operationId: operationId(34),
          reason: reason("approve authorization for the group prototype"),
          stableId: current.stableId,
          type: "reviewPrototypeAuthorization",
        };
      },
    },
    34,
  ),
  step(
    {
      key: "create-version-group-regular",
      resultKey: "versionGroupRegular",
      build: (context) => ({
        grayModelCompleteness: "not_applicable",
        kind: "regular",
        name: "Twin Signal Regular",
        operationId: operationId(35),
        prototypeStableId: context.stableId("prototypeGroup"),
        reason: reason("create a qualifying group version"),
        releaseStatus: "released",
        type: "createFigureVersion",
      }),
    },
    35,
  ),
  step(
    {
      key: "include-prototype-group",
      resultKey: "prototypeGroup",
      build: (context) => {
        const current = versioned(context, "prototypeGroup");
        return {
          expectedVersion: current.lockVersion,
          inclusionStatus: "eligible",
          operationId: operationId(36),
          reason: reason("approve inclusion for the group prototype"),
          stableId: current.stableId,
          type: "reviewPrototypeInclusion",
        };
      },
    },
    36,
  ),
  step(
    {
      key: "create-prototype-third-party",
      resultKey: "prototypeThirdParty",
      build: (context) => ({
        characters: [characterRelation(context, "characterOrin", 0, "primary")],
        costumeText: "Licensed horizon attire",
        figureType: "scale",
        isGroup: false,
        manufacturerStableId: context.stableId("manufacturerActive"),
        operationId: operationId(37),
        reason: reason("create an authorized-third-party fictional prototype"),
        scale: "1/6",
        title: "Licensed Horizon Motion",
        type: "createFigurePrototype",
      }),
    },
    37,
  ),
  step(
    {
      key: "authorize-prototype-third-party",
      resultKey: "prototypeThirdParty",
      build: (context) => {
        const current = versioned(context, "prototypeThirdParty");
        return {
          authorizationEvidence: {
            fixture: true,
            statement: "synthetic third-party authorization evidence",
          },
          authorizationStatus: "authorized_third_party",
          expectedVersion: current.lockVersion,
          operationId: operationId(38),
          reason: reason("approve third-party authorization"),
          stableId: current.stableId,
          type: "reviewPrototypeAuthorization",
        };
      },
    },
    38,
  ),
  step(
    {
      key: "create-version-complete-gray",
      resultKey: "versionCompleteGray",
      build: (context) => ({
        grayModelCompleteness: "complete",
        kind: "regular",
        name: "Horizon Complete Gray",
        operationId: operationId(39),
        prototypeStableId: context.stableId("prototypeThirdParty"),
        reason: reason("create a complete gray fictional version"),
        releaseStatus: "gray_prototype",
        type: "createFigureVersion",
      }),
    },
    39,
  ),
  step(
    {
      key: "include-prototype-third-party",
      resultKey: "prototypeThirdParty",
      build: (context) => {
        const current = versioned(context, "prototypeThirdParty");
        return {
          expectedVersion: current.lockVersion,
          inclusionStatus: "eligible",
          operationId: operationId(40),
          reason: reason(
            "approve inclusion for the authorized-third-party prototype",
          ),
          stableId: current.stableId,
          type: "reviewPrototypeInclusion",
        };
      },
    },
    40,
  ),
  step(
    {
      key: "create-prototype-rejected",
      resultKey: "prototypeRejected",
      build: (context) => ({
        characters: [
          characterRelation(context, "characterAsterAurora", 0, "primary"),
        ],
        costumeText: "Discarded boundary attire",
        figureType: "prize",
        isGroup: false,
        manufacturerStableId: context.stableId("manufacturerDraft"),
        operationId: operationId(41),
        reason: reason("create the prototype that will be rejected"),
        title: "Discarded Boundary Pose",
        type: "createFigurePrototype",
      }),
    },
    41,
  ),
  step(
    {
      key: "reject-prototype",
      resultKey: "prototypeRejected",
      build: (context) => {
        const current = versioned(context, "prototypeRejected");
        return {
          authorizationEvidence: {
            fixture: true,
            statement: "synthetic rejection evidence",
          },
          authorizationStatus: "rejected",
          expectedVersion: current.lockVersion,
          operationId: operationId(42),
          reason: reason("reject authorization for the final prototype"),
          stableId: current.stableId,
          type: "reviewPrototypeAuthorization",
        };
      },
    },
    42,
  ),
  step(
    {
      key: "exclude-rejected-prototype",
      resultKey: "prototypeRejected",
      build: (context) => {
        const current = versioned(context, "prototypeRejected");
        return {
          expectedVersion: current.lockVersion,
          inclusionStatus: "excluded",
          operationId: operationId(43),
          reason: reason(
            "record explicit exclusion for the rejected prototype",
          ),
          stableId: current.stableId,
          type: "reviewPrototypeInclusion",
        };
      },
    },
    43,
  ),
];

function unwrapExecution(execution: FixtureExecution): {
  replayed: boolean;
  result: CatalogCommandResult;
} {
  if ("result" in execution) return execution;
  return { replayed: false, result: execution };
}

function completeRecord<TKey extends string, TValue>(
  keys: readonly TKey[],
  values: Readonly<Partial<Record<TKey, TValue>>>,
  label: string,
): Readonly<Record<TKey, TValue>> {
  const entries = keys.map((key) => {
    const value = values[key];
    if (value === undefined)
      throw new Error(`Catalog fixture did not produce ${label} ${key}.`);
    return [key, value] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<TKey, TValue>
  >;
}

export async function seedCatalog(
  execute: CatalogFixtureExecutor,
): Promise<CatalogFixtureSeedResult> {
  const results: Partial<Record<CatalogFixtureRootKey, CatalogCommandResult>> =
    {};
  const stableIds: Partial<Record<CatalogFixtureEntityKey, string>> = {};
  const commands: CatalogCommand[] = [];
  let replayedOperations = 0;

  const context: PlanContext = {
    result: (key) => {
      const result = results[key];
      if (!result)
        throw new Error(`Catalog fixture dependency ${key} has no result.`);
      return result;
    },
    stableId: (key) => {
      const stableId = stableIds[key];
      if (!stableId)
        throw new Error(`Catalog fixture dependency ${key} has no stable ID.`);
      return stableId;
    },
  };

  for (const planStep of CATALOG_FIXTURE_COMMAND_PLAN) {
    const command = planStep.build(context);
    if (command.operationId !== planStep.operationId) {
      throw new Error(
        `Catalog fixture step ${planStep.key} changed its fixed operation ID.`,
      );
    }
    commands.push(command);
    const execution = unwrapExecution(await execute(command));
    if (execution.replayed) replayedOperations += 1;
    results[planStep.resultKey] = execution.result;
    stableIds[planStep.resultKey] = execution.result.stableId;
    if (planStep.relatedStableKey) {
      if (!execution.result.relatedStableId) {
        throw new Error(
          `Catalog fixture step ${planStep.key} did not return a related stable ID.`,
        );
      }
      stableIds[planStep.relatedStableKey] = execution.result.relatedStableId;
    }
  }

  return {
    commands: Object.freeze(commands),
    replayedOperations,
    results: completeRecord(CATALOG_FIXTURE_ROOT_KEYS, results, "result"),
    stableIds: completeRecord(
      CATALOG_FIXTURE_ENTITY_KEYS,
      stableIds,
      "stable ID",
    ),
  };
}
