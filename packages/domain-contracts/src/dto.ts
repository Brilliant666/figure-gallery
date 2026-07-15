import type {
  CharacterStatus,
  FigureReleaseStatus,
  FigureType,
  FigureVersionKind,
  GrayModelCompleteness,
  ManufacturerStatus,
  PrototypeAuthorizationStatus,
  PrototypeInclusionStatus,
  PrototypePublicationStatus,
  WorkPublicationStatus,
} from "./enums";

export type WorkDTO = {
  displayName: string;
  lockVersion: number;
  originalName?: null | string;
  publicationStatus: WorkPublicationStatus;
  stableId: string;
};

export type CharacterDTO = {
  displayName: string;
  lockVersion: number;
  stableId: string;
  status: CharacterStatus;
  workStableId?: null | string;
};

export type ManufacturerDTO = {
  canonicalName: string;
  lockVersion: number;
  stableId: string;
  status: ManufacturerStatus;
};

export type FigurePrototypeDTO = {
  authorizationStatus: PrototypeAuthorizationStatus;
  figureType: FigureType;
  inclusionStatus: PrototypeInclusionStatus;
  lockVersion: number;
  publicationStatus: PrototypePublicationStatus;
  stableId: string;
  title: string;
};

export type FigureVersionDTO = {
  grayModelCompleteness: GrayModelCompleteness;
  kind: FigureVersionKind;
  lockVersion: number;
  name: string;
  releaseStatus: FigureReleaseStatus;
  stableId: string;
};
