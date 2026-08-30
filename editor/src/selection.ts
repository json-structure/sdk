import type { JsonPointer, NodeId, SourceLocation } from './contracts.js';
export type SelectionKind = 'document' | 'namespace' | 'type' | 'property' | 'relation' | 'source';
export interface SelectionIdentity { readonly kind: SelectionKind; readonly nodeId?: NodeId; readonly pointer?: JsonPointer; readonly location?: SourceLocation; }
export interface NavigationEntry { readonly selection: SelectionIdentity; readonly mode: 'design' | 'graph' | 'source' | 'inspector'; }
export interface SelectionState { readonly selected?: SelectionIdentity; readonly semanticHistory: readonly NavigationEntry[]; readonly historyIndex: number; }
import type { NormalizedDocument } from './model.js';
export type SelectionMode = NavigationEntry['mode'] | 'outline' | 'inspector';
export function resolveSelection(model: NormalizedDocument | undefined, pointer: JsonPointer, kind: SelectionKind = 'property'): SelectionIdentity | undefined {
  const node = model?.nodes.find((candidate) => candidate.pointer === pointer);
  return node ? { kind, nodeId: node.id, pointer: node.pointer, location: node.location } : undefined;
}
export function selectionForMode(selection: SelectionIdentity, mode: SelectionMode): NavigationEntry {
  return { selection, mode: mode === 'outline' || mode === 'inspector' ? 'design' : mode };
}
export function sameSelection(a: SelectionIdentity | undefined, b: SelectionIdentity | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.nodeId === b.nodeId && a.pointer === b.pointer;
}
