import type { JsonPointer, NodeId, RecoveryState, SourceLocation, TextRange } from './contracts.js';
export type DeclarationKind = 'primitive' | 'object' | 'array' | 'set' | 'map' | 'tuple' | 'choice' | 'union' | 'any' | 'unknown';
export interface ModelNode { readonly id: NodeId; readonly pointer: JsonPointer; readonly kind: DeclarationKind; readonly location?: SourceLocation; readonly range?: TextRange; readonly keyRange?: TextRange; }
export interface NormalizedDocument { readonly uri: string; readonly recovery: RecoveryState; readonly nodes: readonly ModelNode[]; readonly rootPointer?: JsonPointer; readonly unknownKeysPreserved: boolean; }
export function nodeId(value: string): NodeId { return value as NodeId; }
export interface SerializationGuarantees { readonly preservesUnknownKeys: true; readonly preservesUnrelatedKeyOrder: true; readonly stableNodeIds: true; readonly editsAreMinimal: true; }
export const SERIALIZATION_GUARANTEES: SerializationGuarantees = { preservesUnknownKeys: true, preservesUnrelatedKeyOrder: true, stableNodeIds: true, editsAreMinimal: true };
