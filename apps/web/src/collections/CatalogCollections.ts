import type { CollectionConfig } from 'payload'

import {
  Character,
  CharacterAlias,
  FigurePrototype,
  FigurePrototypeCharacter,
  FigureVersion,
  Manufacturer,
  OperationLog,
  Work,
} from './catalog'

export {
  Character,
  CharacterAlias,
  FigurePrototype,
  FigurePrototypeCharacter,
  FigureVersion,
  Manufacturer,
  OperationLog,
  Work,
}

export const CatalogCollections: CollectionConfig[] = [
  Work,
  Character,
  CharacterAlias,
  Manufacturer,
  FigurePrototype,
  FigurePrototypeCharacter,
  FigureVersion,
  OperationLog,
]
