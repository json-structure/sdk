import type { JsonPointer, NodeId, SourceLocation } from './contracts.js';
/**
 * Type alias for selection kind.
 */
export type SelectionKind = 'document' | 'namespace' | 'type' | 'property' | 'relation' | 'source';
/**
 * Defines the selection identity shape.
 */
export interface SelectionIdentity { readonly kind: SelectionKind; readonly nodeId?: NodeId; readonly pointer?: JsonPointer; readonly location?: SourceLocation; }
/**
 * Defines the navigation entry shape.
 */
export interface NavigationEntry { readonly selection: SelectionIdentity; readonly mode: 'design' | 'graph' | 'source' | 'inspector'; }
/**
 * Defines the selection state shape.
 */
export interface SelectionState { readonly selected?: SelectionIdentity; readonly semanticHistory: readonly NavigationEntry[]; readonly historyIndex: number; }
import type { NormalizedDocument } from './model.js';
/**
 * Type alias for selection mode.
 */
export type SelectionMode = NavigationEntry['mode'] | 'outline' | 'inspector';
/**
 * Resolves selection for the current document.
 */
export function resolveSelection(model: NormalizedDocument | undefined, pointer: JsonPointer, kind: SelectionKind = 'property'): SelectionIdentity | undefined {
  const node = model?.nodes.find((candidate) => candidate.pointer === pointer);
  return node ? { kind, nodeId: node.id, pointer: node.pointer, location: node.location } : undefined;
}
/**
 * Performs selection for mode logic.
 */
export function selectionForMode(selection: SelectionIdentity, mode: SelectionMode): NavigationEntry {
  return { selection, mode: mode === 'outline' || mode === 'inspector' ? 'design' : mode };
}
/**
 * Performs same selection logic.
 */
export function sameSelection(a: SelectionIdentity | undefined, b: SelectionIdentity | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.nodeId === b.nodeId && a.pointer === b.pointer;
}
