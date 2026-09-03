import type { JsonPointer, NodeId } from './contracts.js';
/** Type alias for projection id. */
export type ProjectionId = 'namespaces' | 'relations' | 'extends' | 'imports';
/** A direction used when expanding a relation neighborhood. */
export type GraphRelationDirection = 'outgoing' | 'incoming' | 'both';
/** Short alias for integrations that expose a relation mode selector. */
export type RelationDirection = GraphRelationDirection;
/** Type alias for hit target kind. */
export type HitTargetKind = 'handle' | 'qualifier' | 'label' | 'edge' | 'node' | 'group' | 'canvas';
/** Defines the camera state shape. */
export interface CameraState { readonly x: number; readonly y: number; readonly zoom: number; }
/** Defines the graph projection shape. */
export interface GraphProjection { readonly id: ProjectionId; readonly nodes: readonly NodeId[]; readonly edges: readonly GraphEdge[]; }
/** Defines the graph edge shape. */
export interface GraphEdge {
  readonly id: string;
  readonly kind: 'root' | 'relation' | 'qualifier' | 'relation-qualifier' | 'inheritance' | 'reference' | 'import';
  readonly source: NodeId;
  readonly target: NodeId;
  readonly pointer?: JsonPointer;
  readonly targetPointer?: JsonPointer;
  readonly targetValue?: string;
  readonly documentUri?: string;
  readonly provenance?: 'local' | 'import' | 'importdefs';
  readonly status?: GraphResolutionStatus;
  readonly cardinality?: 'single' | 'multiple';
  readonly scope?: JsonPointer | readonly JsonPointer[];
  readonly semanticBinding?: string;
  readonly relation?: GraphRelationMetadata;
  readonly targetIdentity?: GraphTargetIdentity;
  readonly qualifierIdentity?: GraphTargetIdentity;
  readonly relationPointer?: JsonPointer;
  readonly relationName?: string;
  readonly declaringSource?: JsonPointer;
  readonly normalizedScopes?: readonly JsonPointer[];
  readonly scopeForm?: 'scalar' | 'array';
  readonly qualifierReference?: string;
  readonly targetIdentityProperties?: readonly string[];
  readonly qualifierIdentityProperties?: readonly string[];
  readonly reason?: string;
  readonly memberEdgeIds?: readonly string[];
  readonly memberPointers?: readonly JsonPointer[];
}
/** Resolution states are explicit so unresolved values are never represented as `any`. */
export type GraphResolutionStatus = 'resolved' | 'unresolved' | 'indeterminate' | 'external';
/** A graph field whose value is not available must carry its resolution state. */
export type GraphValue<T> =
  | { readonly status: 'resolved' | 'external'; readonly value: T }
  | { readonly status: 'unresolved' | 'indeterminate'; readonly raw?: string; readonly reason?: string };
/** Explicit relation facts retained even when one of the referenced types is unresolved. */
export interface GraphRelationMetadata {
  readonly name: string;
  readonly target: GraphValue<JsonPointer>;
  readonly qualifier?: GraphValue<JsonPointer>;
  readonly cardinality?: GraphValue<'single' | 'multiple'>;
  readonly scope?: GraphValue<JsonPointer | readonly JsonPointer[]>;
  readonly semanticBinding?: GraphValue<string>;
}
/** Identity of a target or qualifier, including imported-document provenance. */
export interface GraphTargetIdentity {
  readonly reference: string;
  readonly pointer?: JsonPointer;
  readonly documentUri?: string;
  readonly status: GraphResolutionStatus;
  readonly provenance?: 'local' | 'import' | 'importdefs';
}
/** Stable identity emitted for a graph node selection. */
export interface GraphNodeIdentity { readonly kind: 'node'; readonly nodeId: NodeId; readonly pointer?: JsonPointer; readonly documentUri?: string; }
/** Stable identity emitted for a relation selection. */
export interface GraphEdgeIdentity { readonly kind: 'edge'; readonly edgeId: string; readonly source: NodeId; readonly target: NodeId; readonly pointer?: JsonPointer; }
/** Selection identity shared by graph and design integrations. */
export type GraphSelectionIdentity = GraphNodeIdentity | GraphEdgeIdentity;
/** Typed graph selection event for host-owned Graph ↔ Design synchronization. */
export interface GraphSelectionEvent { readonly type: 'selection-changed'; readonly origin: 'graph' | 'design'; readonly selection?: GraphSelectionIdentity; }
/** Typed graph location event for host-owned navigation synchronization. */
export interface GraphLocationEvent { readonly type: 'location-changed'; readonly origin: 'graph' | 'design'; readonly projection: ProjectionId; readonly level: 'atlas' | 'types' | 'neighborhood'; readonly focusNodeId?: NodeId; readonly direction?: GraphRelationDirection; }
/** Events a graph surface may publish without coupling itself to a DOM owner. */
export type GraphEvent = GraphSelectionEvent | GraphLocationEvent;
/** Listener contract for graph integration hooks. */
export type GraphEventListener = (event: GraphEvent) => void;
/** Small typed event hub useful to central UI owners and host adapters. */
export class GraphEventHub {
  private readonly listeners = new Set<GraphEventListener>();
  public subscribe(listener: GraphEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public emit(event: GraphEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
/** Constant for semantic zoom. */
export const SEMANTIC_ZOOM = { min: 0.6, max: 1.6 } as const;
const precedence: readonly HitTargetKind[] = ['handle', 'qualifier', 'label', 'edge', 'node', 'group', 'canvas'];
/** Returns hit-test precedence for graph interaction targeting. */
export function hitPrecedence(kind: HitTargetKind): number { return precedence.indexOf(kind); }
/** Defines the gesture contract shape. */
export interface GestureContract { readonly dragThresholdCssPx: 4; readonly touchTargetCssPx: 44; readonly wheelOverViewportOnly: true; readonly geometricZoomIsNotHistory: true; readonly doubleActivationIsNonMutatingBeforeOpen: true; }
/** Constant for gesture contract. */
export const GESTURE_CONTRACT: GestureContract = { dragThresholdCssPx: 4, touchTargetCssPx: 44, wheelOverViewportOnly: true, geometricZoomIsNotHistory: true, doubleActivationIsNonMutatingBeforeOpen: true };
