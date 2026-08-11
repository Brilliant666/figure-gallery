export const WORK_TYPES = [
  "animation",
  "game",
  "comic",
  "novel",
  "other",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_PUBLICATION_STATUSES = [
  "draft",
  "published",
  "hidden",
] as const;
export type WorkPublicationStatus = (typeof WORK_PUBLICATION_STATUSES)[number];

export const CHARACTER_STATUSES = [
  "active",
  "matching_pending",
  "hidden",
] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

export const CHARACTER_ALIAS_TYPES = [
  "official",
  "translation",
  "common",
  "romanization",
  "source_only",
] as const;
export type CharacterAliasType = (typeof CHARACTER_ALIAS_TYPES)[number];

export const MANUFACTURER_STATUSES = ["draft", "active", "hidden"] as const;
export type ManufacturerStatus = (typeof MANUFACTURER_STATUSES)[number];

export const FIGURE_TYPES = ["scale", "prize", "static"] as const;
export type FigureType = (typeof FIGURE_TYPES)[number];

export const PROTOTYPE_AUTHORIZATION_STATUSES = [
  "pending",
  "official",
  "authorized_third_party",
  "rejected",
] as const;
export type PrototypeAuthorizationStatus =
  (typeof PROTOTYPE_AUTHORIZATION_STATUSES)[number];

export const PROTOTYPE_INCLUSION_STATUSES = [
  "pending",
  "eligible",
  "excluded",
] as const;
export type PrototypeInclusionStatus =
  (typeof PROTOTYPE_INCLUSION_STATUSES)[number];

export const PROTOTYPE_PUBLICATION_STATUSES = [
  "draft",
  "published",
  "hidden",
  "merged",
  "archived",
] as const;
export type PrototypePublicationStatus =
  (typeof PROTOTYPE_PUBLICATION_STATUSES)[number];

export const PROTOTYPE_CHARACTER_ROLES = [
  "primary",
  "secondary",
  "companion",
] as const;
export type PrototypeCharacterRole = (typeof PROTOTYPE_CHARACTER_ROLES)[number];

export const FIGURE_VERSION_KINDS = [
  "regular",
  "deluxe",
  "reissue",
  "bonus",
  "recolor",
  "channel-exclusive",
] as const;
export type FigureVersionKind = (typeof FIGURE_VERSION_KINDS)[number];

export const FIGURE_RELEASE_STATUSES = [
  "announced",
  "gray_prototype",
  "painted_prototype",
  "preorder",
  "released",
  "cancelled",
  "unknown",
] as const;
export type FigureReleaseStatus = (typeof FIGURE_RELEASE_STATUSES)[number];

export const GRAY_MODEL_COMPLETENESS = [
  "not_applicable",
  "complete",
  "partial",
  "unknown",
] as const;
export type GrayModelCompleteness = (typeof GRAY_MODEL_COMPLETENESS)[number];

export const OPERATION_ACTOR_TYPES = ["admin", "system"] as const;
export type OperationActorType = (typeof OPERATION_ACTOR_TYPES)[number];

export const OPERATION_DUTY_CONTEXTS = [
  "catalog_maintenance",
  "catalog_review",
] as const;
export type OperationDutyContext = (typeof OPERATION_DUTY_CONTEXTS)[number];
