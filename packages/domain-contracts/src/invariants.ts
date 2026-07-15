import type {
  FigureReleaseStatus,
  GrayModelCompleteness,
  PrototypeAuthorizationStatus,
  PrototypeCharacterRole,
} from "./enums";

export type PrototypeCharacterInput = {
  characterStableId: string;
  displayOrder: number;
  role: PrototypeCharacterRole;
};

export function validatePrototypeCharacters(
  characters: readonly PrototypeCharacterInput[],
  isGroup: boolean,
): string[] {
  const errors: string[] = [];
  if (characters.length === 0)
    errors.push("at least one character is required");
  if (characters.filter(({ role }) => role === "primary").length !== 1) {
    errors.push("exactly one primary character is required");
  }
  if (!isGroup && characters.length > 1)
    errors.push("multiple characters require isGroup=true");
  if (
    new Set(characters.map(({ characterStableId }) => characterStableId))
      .size !== characters.length
  ) {
    errors.push("character relationships must be unique");
  }
  if (
    new Set(characters.map(({ displayOrder }) => displayOrder)).size !==
    characters.length
  ) {
    errors.push("displayOrder must be unique within a prototype");
  }
  if (
    characters.some(
      ({ displayOrder }) => !Number.isInteger(displayOrder) || displayOrder < 0,
    )
  ) {
    errors.push("displayOrder must be a non-negative integer");
  }
  return errors;
}

export function grayCompletenessIsValid(
  releaseStatus: FigureReleaseStatus,
  grayModelCompleteness: GrayModelCompleteness,
): boolean {
  return releaseStatus === "gray_prototype"
    ? grayModelCompleteness !== "not_applicable"
    : grayModelCompleteness === "not_applicable";
}

export function versionQualifiesForInclusion(
  releaseStatus: FigureReleaseStatus,
  grayModelCompleteness: GrayModelCompleteness,
): boolean {
  if (!grayCompletenessIsValid(releaseStatus, grayModelCompleteness))
    return false;
  if (releaseStatus === "gray_prototype")
    return grayModelCompleteness === "complete";
  return ["announced", "painted_prototype", "preorder", "released"].includes(
    releaseStatus,
  );
}

export function authorizationQualifiesForInclusion(
  authorizationStatus: PrototypeAuthorizationStatus,
): boolean {
  return (
    authorizationStatus === "official" ||
    authorizationStatus === "authorized_third_party"
  );
}
