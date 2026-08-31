export type MetaSchemaMode = 'core' | 'validation' | 'semantic-annotations' | 'relations' | 'extended' | 'unknown';

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

const SCHEMAS: Readonly<Record<string, MetaSchemaMode>> = {
  'https://json-structure.org/meta/core/v0/#': 'core',
  'https://json-structure.org/meta/validation/v0/#': 'validation',
  'https://json-structure.org/meta/semantic-annotations/v0/#': 'semantic-annotations',
  'https://json-structure.org/meta/relations/v0/#': 'relations',
  'https://json-structure.org/meta/extended/v0/#': 'extended'
};

const USES = {
  validation: 'JSONStructureValidation',
  conditionalComposition: 'JSONStructureConditionalComposition',
  units: 'JSONStructureUnits',
  semanticAnnotations: 'JSONStructureSemanticAnnotations',
  alternateNames: 'JSONStructureAlternateNames',
  imports: 'JSONStructureImport',
  relations: 'JSONStructureRelations'
} as const;

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
  const root = isObject(value) ? value : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const mode = schema ? SCHEMAS[schema] ?? 'unknown' : 'core';
  const uses = Array.isArray(root.$uses) ? root.$uses.filter((entry): entry is string => typeof entry === 'string') : [];
  const knownUses = new Set<string>(Object.values(USES));
  const extended = mode === 'extended';
  return {
    mode,
    schema,
    capabilities: {
      core: true,
      validation: mode === 'validation' || extended && uses.includes(USES.validation),
      conditionalComposition: mode === 'validation' || extended && uses.includes(USES.conditionalComposition),
      units: mode === 'validation' || extended && uses.includes(USES.units),
      semanticAnnotations: mode === 'semantic-annotations' || extended && uses.includes(USES.semanticAnnotations),
      alternateNames: mode === 'validation' || extended && uses.includes(USES.alternateNames),
      imports: mode === 'relations' || extended && uses.includes(USES.imports),
      relations: mode === 'relations' || extended && uses.includes(USES.relations),
      unknownUses: uses.filter((entry) => !knownUses.has(entry))
    }
  };
}

export function paletteDescriptors(value: unknown): readonly PaletteDescriptor[] {
  const { capabilities } = detectMetaSchemaMode(value);
  return PALETTES.filter((palette) => palette.capability === 'core' || capabilities[palette.capability]);
}

export const describeMetaSchemaPalettes = paletteDescriptors;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}