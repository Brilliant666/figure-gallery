import type { CollectionConfig } from 'payload'

import {
  Character,
  CharacterAlias,
  CatalogItem,
  FigurePrototype,
  FigurePrototypeCharacter,
  FigureVersion,
  Manufacturer,
  OperationLog,
  SourceRecord,
  Work,
} from './catalog'

export {
  Character,
  CharacterAlias,
  CatalogItem,
  FigurePrototype,
  FigurePrototypeCharacter,
  FigureVersion,
  Manufacturer,
  OperationLog,
  SourceRecord,
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
  CatalogItem,
  SourceRecord,
  OperationLog,
]
