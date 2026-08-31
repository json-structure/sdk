import type { JsonPointer, NodeId, RecoveryState, SourceLocation, TextRange } from './contracts.js';
export type DeclarationKind = 'primitive' | 'object' | 'array' | 'set' | 'map' | 'tuple' | 'choice' | 'union' | 'any' | 'unknown';
export interface ModelNode { readonly id: NodeId; readonly pointer: JsonPointer; readonly kind: DeclarationKind; readonly location?: SourceLocation; readonly range?: TextRange; readonly keyRange?: TextRange; }

export interface ValidationProjection {
	readonly minimum?: number | string;
	readonly maximum?: number | string;
	readonly exclusiveMinimum?: number | string;
	readonly exclusiveMaximum?: number | string;
	readonly multipleOf?: number | string;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly format?: string;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly uniqueItems?: boolean;
	readonly minContains?: number;
	readonly effectiveMinContains?: EffectiveAnnotationValue<number>;
	readonly maxContains?: number;
	readonly minProperties?: number;
	readonly maxProperties?: number;
	readonly minEntries?: number;
	readonly maxEntries?: number;
	readonly default?: unknown;
	readonly contains?: Record<string, unknown>;
	readonly propertyNames?: Record<string, unknown>;
	readonly keyNames?: Record<string, unknown>;
	readonly has?: Record<string, unknown>;
	readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
	readonly patternProperties?: Readonly<Record<string, Record<string, unknown>>>;
	readonly patternKeys?: Readonly<Record<string, Record<string, unknown>>>;
}

export interface ConditionalCompositionProjection {
	readonly allOf?: readonly Record<string, unknown>[];
	readonly anyOf?: readonly Record<string, unknown>[];
	readonly oneOf?: readonly Record<string, unknown>[];
	readonly not?: Record<string, unknown>;
	readonly if?: Record<string, unknown>;
	readonly then?: Record<string, unknown>;
	readonly else?: Record<string, unknown>;
	readonly inspection: readonly ConditionalCompositionInspection[];
}

export interface ConditionalCompositionInspection {
	readonly keyword: 'allOf' | 'anyOf' | 'oneOf' | 'not' | 'if' | 'then' | 'else';
	readonly authored: unknown;
	readonly effective: unknown;
	readonly emittedJson: string;
}

export interface UnitsProjection {
	readonly symbol?: string;
	readonly symbols?: Readonly<Record<string, string>>;
	readonly unit?: string;
	readonly ucumUnit?: string;
	readonly currency?: string;
	readonly preferredComputationalUnit?: EffectiveAnnotationValue<string>;
}

export interface ReferenceProjection {
	readonly pointer: JsonPointer;
	readonly target: string;
	readonly kind: 'root' | 'ref' | 'extends';
}

export type ResolutionStatus = 'resolved' | 'unresolved' | 'indeterminate';
export type ResolvedReferenceKind = 'root' | 'ref' | 'extends' | 'relation-target' | 'relation-qualifier';
export interface ImportOrigin {
	readonly documentUri: string;
	readonly pointer: JsonPointer;
	readonly importSource: string;
	readonly importPointer: JsonPointer;
	readonly provenance: 'import' | 'importdefs';
}
export interface ReferenceResolutionFact {
	readonly pointer: JsonPointer;
	readonly target: string;
	readonly normalizedTarget?: JsonPointer;
	readonly kind: ResolvedReferenceKind;
	readonly status: ResolutionStatus;
	readonly targetPointer?: JsonPointer;
	readonly targetDocumentUri?: string;
	readonly importOrigins: readonly ImportOrigin[];
	readonly reason?: string;
}
export interface ImportResolutionFact {
	readonly pointer: JsonPointer;
	readonly namespacePointer: JsonPointer;
	readonly source: string;
	readonly documentUri?: string;
	readonly provenance: 'import' | 'importdefs';
	readonly status: ResolutionStatus;
	readonly importedPointers: readonly JsonPointer[];
	readonly reason?: string;
}
export interface ReferenceResolutionProjection {
	readonly references: readonly ReferenceResolutionFact[];
	readonly imports: readonly ImportResolutionFact[];
}

export interface SemanticPlacementProjection {
	readonly pointer: JsonPointer;
	readonly annotations: SemanticAnnotationsProjection;
	readonly inspection: readonly SemanticAnnotationInspection[];
}

export interface SemanticAnnotationInspection {
	readonly keyword: keyof SemanticAnnotationsProjection;
	readonly authored: unknown;
	readonly effective: unknown;
	readonly normativeDefaults?: unknown;
	readonly emittedJson: string;
	readonly resolution: 'local' | 'indeterminate';
	readonly advisory: boolean;
}

export interface RelationProjection {
	readonly pointer: JsonPointer;
	readonly name: string;
	readonly targetTypeRef?: string;
	readonly cardinality?: string;
	readonly scope?: string | readonly string[];
	readonly qualifierTypeRef?: string;
}

export interface SemanticAnnotationsProjection {
	readonly concepts?: readonly Record<string, unknown>[];
	readonly observedProperty?: Record<string, unknown>;
	readonly semanticRole?: string;
	readonly derivation?: string;
	readonly statistic?: string | Record<string, unknown>;
	readonly codedValues?: Record<string, unknown>;
	readonly measurementConditioning?: Record<string, unknown>;
	readonly referenceRole?: string;
	readonly phenomenonTimeRelation?: string;
	readonly supportPeriod?: Record<string, unknown>;
	readonly temporalReferenceSystem?: Record<string, unknown>;
	readonly cadence?: Record<string, unknown>;
	readonly coordinateReferenceSystem?: Record<string, unknown>;
	readonly vectorReferenceFrames?: readonly Record<string, unknown>[];
	readonly tensorReferenceFrames?: readonly Record<string, unknown>[];
	readonly frameTransforms?: readonly Record<string, unknown>[];
	readonly linearReferenceSystem?: Record<string, unknown>;
	readonly colorSpaces?: readonly Record<string, unknown>[];
	readonly audioChannels?: readonly Record<string, unknown>[];
	readonly spectralBands?: readonly Record<string, unknown>[];
}
export interface DefinitionProjection {
	readonly pointer: JsonPointer;
	readonly name: string;
	readonly namespacePointer: JsonPointer;
	readonly reusable: boolean;
	readonly type?: string;
	readonly coreForm: 'typed' | 'ref' | 'composed' | 'unknown';
	readonly extends?: string | readonly string[];
	readonly identity?: readonly string[];
	readonly relations: readonly RelationProjection[];
	readonly units?: UnitsProjection;
	readonly validation?: ValidationProjection;
	readonly composition?: ConditionalCompositionProjection;
	readonly semantic?: SemanticAnnotationsProjection;
	readonly required?: readonly string[] | readonly (readonly string[])[];
	readonly properties?: Readonly<Record<string, Record<string, unknown>>>;
	readonly items?: Record<string, unknown>;
	readonly values?: Record<string, unknown>;
	readonly tuple?: readonly string[];
	readonly description?: string;
	readonly binary?: BinaryAnnotationsProjection;
}
export interface BinaryAnnotationsProjection {
	readonly contentEncoding: EffectiveAnnotationValue<string>;
	readonly contentCompression?: string;
	readonly contentMediaType?: string;
}
export interface EffectiveAnnotationValue<T> {
	readonly explicit?: T;
	readonly effective: T;
}
export interface ImportProjection {
	readonly pointer: JsonPointer;
	readonly namespacePointer: JsonPointer;
	readonly keyword: '$import' | '$importdefs';
	readonly source: string;
	readonly provenance: 'import' | 'importdefs';
}
export interface DiagnosticsProjection {
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'info' | 'indeterminate';
	readonly pointer?: JsonPointer;
}
export interface NormalizedProjections {
	readonly definitions: readonly DefinitionProjection[];
	readonly imports: readonly ImportProjection[];
	readonly references: readonly ReferenceProjection[];
	readonly resolution?: ReferenceResolutionProjection;
	readonly semanticPlacements: readonly SemanticPlacementProjection[];
	readonly diagnostics: readonly DiagnosticsProjection[];
}
export interface NormalizedDocument { readonly uri: string; readonly documentId?: string; readonly name?: string; readonly recovery: RecoveryState; readonly nodes: readonly ModelNode[]; readonly rootPointer?: JsonPointer; readonly unknownKeysPreserved: boolean; readonly projections: NormalizedProjections; }
export function nodeId(value: string): NodeId { return value as NodeId; }
export interface SerializationGuarantees { readonly preservesUnknownKeys: true; readonly preservesUnrelatedKeyOrder: true; readonly stableNodeIds: true; readonly editsAreMinimal: true; }
export const SERIALIZATION_GUARANTEES: SerializationGuarantees = { preservesUnknownKeys: true, preservesUnrelatedKeyOrder: true, stableNodeIds: true, editsAreMinimal: true };
