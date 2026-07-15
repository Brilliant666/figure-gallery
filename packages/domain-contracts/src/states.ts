import type {
  CharacterStatus,
  ManufacturerStatus,
  PrototypePublicationStatus,
  WorkPublicationStatus,
} from './enums'

export const WORK_STATUS_TRANSITIONS: Readonly<Record<WorkPublicationStatus, readonly WorkPublicationStatus[]>> = {
  draft: ['published', 'hidden'],
  published: ['hidden'],
  hidden: ['draft', 'published'],
}

export const CHARACTER_STATUS_TRANSITIONS: Readonly<Record<CharacterStatus, readonly CharacterStatus[]>> = {
  matching_pending: ['active', 'hidden'],
  active: ['hidden'],
  hidden: ['active'],
}

export const MANUFACTURER_STATUS_TRANSITIONS: Readonly<Record<ManufacturerStatus, readonly ManufacturerStatus[]>> = {
  draft: ['active', 'hidden'],
  active: ['hidden'],
  hidden: ['active'],
}

export const PR01_PROTOTYPE_STATUS_TRANSITIONS: Readonly<
  Record<PrototypePublicationStatus, readonly PrototypePublicationStatus[]>
> = {
  draft: ['hidden', 'archived'],
  published: [],
  hidden: ['draft', 'archived'],
  merged: [],
  archived: ['draft'],
}

export function transitionIsAllowed<T extends string>(
  transitions: Readonly<Record<T, readonly T[]>>,
  from: T,
  to: T,
): boolean {
  return transitions[from].includes(to)
}
