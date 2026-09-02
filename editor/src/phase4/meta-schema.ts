import { CAPABILITY_USES, resolveMetaSchemaCapabilityProfile, type CanonicalMetaSchemaMode } from '../capabilities.js';

export type MetaSchemaMode = CanonicalMetaSchemaMode | 'unknown';

export interface MetaSchemaCapabilities {
  readonly core: true;
  readonly validation: boolean;
  readonly conditionalComposition: boolean;
  readonly units: boolean;
  readonly semanticAnnotations: boolean;
  readonly alternateNames: boolean;
  readonly imports: boolean;
  readonly relations: boolean;
  readonly unknownUses: readonly string[];
}

export interface MetaSchemaDetection {
  readonly mode: MetaSchemaMode;
  readonly schema?: string;
  readonly capabilities: MetaSchemaCapabilities;
}

export interface PaletteDescriptor {
  readonly id: string;
  readonly label: string;
  readonly capability: keyof Omit<MetaSchemaCapabilities, 'core' | 'unknownUses'> | 'core';
  readonly members: readonly string[];
}

const PALETTES: readonly PaletteDescriptor[] = [
  { id: 'document', label: 'Document', capability: 'core', members: ['$schema', '$id', 'name', 'description', '$uses', '$offers', '$root', 'definitions'] },
  { id: 'core', label: 'Core declarations', capability: 'core', members: ['type', '$ref', '$extends', 'properties', 'required', 'items', 'values', 'tuple', 'choices', 'enum', 'const'] },
  { id: 'validation', label: 'Validation', capability: 'validation', members: ['minimum', 'maximum', 'pattern', 'format', 'default', 'minItems', 'maxItems', 'dependentRequired', 'patternProperties'] },
  { id: 'composition', label: 'Conditional composition', capability: 'conditionalComposition', members: ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'] },
  { id: 'units', label: 'Units', capability: 'units', members: ['symbol', 'symbols', 'unit', 'ucumUnit', 'currency'] },
  { id: 'semantic', label: 'Semantic annotations', capability: 'semanticAnnotations', members: ['concepts', 'observedProperty', 'semanticRole', 'derivation', 'statistic', 'codedValues'] },
  { id: 'alternate-names', label: 'Alternate names', capability: 'alternateNames', members: ['altnames', 'altenums', 'descriptions'] },
  { id: 'imports', label: 'Imports', capability: 'imports', members: ['$import', '$importdefs'] },
  { id: 'relations', label: 'Relations', capability: 'relations', members: ['relations', 'targettype', 'qualifiertype', 'cardinality', 'scope'] }
];

export function detectMetaSchemaMode(value: unknown): MetaSchemaDetection {
  const profile = resolveMetaSchemaCapabilityProfile(value);
  const { activeUses } = profile;
  return {
    mode: profile.mode,
    schema: profile.schema,
    capabilities: {
      core: true,
      validation: activeUses.has(CAPABILITY_USES.validation),
      conditionalComposition: activeUses.has(CAPABILITY_USES.conditionalComposition),
      units: activeUses.has(CAPABILITY_USES.units),
      semanticAnnotations: activeUses.has(CAPABILITY_USES.semanticAnnotations),
      alternateNames: activeUses.has(CAPABILITY_USES.alternateNames),
      imports: activeUses.has(CAPABILITY_USES.imports),
      relations: activeUses.has(CAPABILITY_USES.relations),
      unknownUses: profile.unknownUses
    }
  };
}

export function paletteDescriptors(value: unknown): readonly PaletteDescriptor[] {
  const { capabilities } = detectMetaSchemaMode(value);
  return PALETTES.filter((palette) => palette.capability === 'core' || capabilities[palette.capability]);
}

export const describeMetaSchemaPalettes = paletteDescriptors;
