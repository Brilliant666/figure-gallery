import type {
  CharacterAliasType,
  CharacterStatus,
  FigureReleaseStatus,
  FigureType,
  FigureVersionKind,
  GrayModelCompleteness,
  ManufacturerStatus,
  PrototypeAuthorizationStatus,
  PrototypeCharacterRole,
  PrototypeInclusionStatus,
  PrototypePublicationStatus,
  WorkPublicationStatus,
  WorkType,
} from "./enums";

export type StableId = string & { readonly __stableId: unique symbol };
export type OperationId = string & { readonly __operationId: unique symbol };
export type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export type CatalogCommandBase<TType extends string> = {
  operationId: string;
  reason: string;
  type: TType;
};

export type VersionedCatalogCommandBase<TType extends string> =
  CatalogCommandBase<TType> & {
    expectedVersion: number;
    stableId: string;
  };

export type ManufacturerAliasInput = { locale?: string; value: string };
export type PrototypeCharacterCommandInput = {
  characterStableId: string;
  displayOrder: number;
  role: PrototypeCharacterRole;
};

export type CatalogCommand =
  | (CatalogCommandBase<"createWork"> & {
      displayName: string;
      originalName?: string;
      workType?: WorkType;
    })
  | (VersionedCatalogCommandBase<"updateWork"> & {
      displayName?: string;
      originalName?: null | string;
      workType?: null | WorkType;
    })
  | (VersionedCatalogCommandBase<"setWorkPublicationStatus"> & {
      publicationStatus: WorkPublicationStatus;
    })
  | VersionedCatalogCommandBase<"softDeleteWork">
  | VersionedCatalogCommandBase<"restoreWork">
  | (CatalogCommandBase<"createCharacter"> & {
      displayName: string;
      nameEn?: string;
      nameJa?: string;
      nameZh?: string;
      status?: CharacterStatus;
      workStableId?: string;
    })
  | (VersionedCatalogCommandBase<"updateCharacter"> & {
      displayName?: string;
      nameEn?: null | string;
      nameJa?: null | string;
      nameZh?: null | string;
      workStableId?: null | string;
    })
  | (VersionedCatalogCommandBase<"addCharacterAlias"> & {
      aliasType: CharacterAliasType;
      isPreferred?: boolean;
      locale?: string;
      value: string;
    })
  | (VersionedCatalogCommandBase<"updateCharacterAlias"> & {
      aliasStableId: string;
      aliasType?: CharacterAliasType;
      isPreferred?: boolean;
      locale?: null | string;
      value?: string;
    })
  | (VersionedCatalogCommandBase<"removeCharacterAlias"> & {
      aliasStableId: string;
    })
  | (VersionedCatalogCommandBase<"setCharacterStatus"> & {
      status: CharacterStatus;
    })
  | VersionedCatalogCommandBase<"softDeleteCharacter">
  | VersionedCatalogCommandBase<"restoreCharacter">
  | (CatalogCommandBase<"createManufacturer"> & {
      aliases?: ManufacturerAliasInput[];
      authorizationNote?: string;
      canonicalName: string;
      officialSiteUrl?: string;
      sourceEvidence?: JsonValue;
    })
  | (VersionedCatalogCommandBase<"updateManufacturer"> & {
      aliases?: ManufacturerAliasInput[];
      authorizationNote?: null | string;
      canonicalName?: string;
      officialSiteUrl?: null | string;
      sourceEvidence?: JsonValue;
    })
  | (VersionedCatalogCommandBase<"setManufacturerStatus"> & {
      status: ManufacturerStatus;
    })
  | VersionedCatalogCommandBase<"softDeleteManufacturer">
  | VersionedCatalogCommandBase<"restoreManufacturer">
  | (CatalogCommandBase<"createFigurePrototype"> & {
      characters: PrototypeCharacterCommandInput[];
      costumeText?: string;
      figureType: FigureType;
      isGroup: boolean;
      manufacturerStableId: string;
      scale?: string;
      title: string;
      workStableId?: string;
    })
  | (VersionedCatalogCommandBase<"updateFigurePrototype"> & {
      costumeText?: null | string;
      figureType?: FigureType;
      manufacturerStableId?: string;
      scale?: null | string;
      title?: string;
      workStableId?: null | string;
    })
  | (VersionedCatalogCommandBase<"setPrototypeCharacters"> & {
      characters: PrototypeCharacterCommandInput[];
      isGroup: boolean;
    })
  | (VersionedCatalogCommandBase<"reviewPrototypeAuthorization"> & {
      authorizationEvidence?: JsonValue;
      authorizationStatus: Exclude<PrototypeAuthorizationStatus, "pending">;
    })
  | (VersionedCatalogCommandBase<"reviewPrototypeInclusion"> & {
      inclusionStatus: Exclude<PrototypeInclusionStatus, "pending">;
    })
  | (VersionedCatalogCommandBase<"setPrototypePublicationStatus"> & {
      publicationStatus: PrototypePublicationStatus;
    })
  | VersionedCatalogCommandBase<"archivePrototype">
  | VersionedCatalogCommandBase<"restorePrototype">
  | (CatalogCommandBase<"createFigureVersion"> & {
      channelOrDistributorLabel?: string;
      grayModelCompleteness: GrayModelCompleteness;
      kind: FigureVersionKind;
      name: string;
      notes?: string;
      prototypeStableId: string;
      releaseDate?: string;
      releaseStatus: FigureReleaseStatus;
      skuOrCode?: string;
    })
  | (VersionedCatalogCommandBase<"updateFigureVersion"> & {
      channelOrDistributorLabel?: null | string;
      grayModelCompleteness?: GrayModelCompleteness;
      kind?: FigureVersionKind;
      name?: string;
      notes?: null | string;
      releaseDate?: null | string;
      releaseStatus?: FigureReleaseStatus;
      skuOrCode?: null | string;
    })
  | VersionedCatalogCommandBase<"softDeleteFigureVersion">
  | VersionedCatalogCommandBase<"restoreFigureVersion">;

export type CatalogCommandResult = {
  entityType: string;
  lockVersion: number;
  operationId: string;
  relatedStableId?: string;
  stableId: string;
  status?: string;
  warnings?: CatalogCommandWarning[];
};

export type CatalogCommandWarning = {
  code: string;
  message: string;
};
