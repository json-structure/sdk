import type { NodeId } from './contracts.js';
/**
 * Type alias for projection id.
 */
export type ProjectionId = 'namespaces' | 'relations' | 'extends' | 'imports';
/**
 * Type alias for hit target kind.
 */
export type HitTargetKind = 'handle' | 'qualifier' | 'label' | 'edge' | 'node' | 'group' | 'canvas';
/**
 * Defines the camera state shape.
 */
export interface CameraState { readonly x: number; readonly y: number; readonly zoom: number; }
/**
 * Defines the graph projection shape.
 */
export interface GraphProjection { readonly id: ProjectionId; readonly nodes: readonly NodeId[]; readonly edges: readonly GraphEdge[]; }
/**
 * Defines the graph edge shape.
 */
export interface GraphEdge { readonly id: string; readonly kind: 'relation' | 'qualifier' | 'inheritance' | 'reference' | 'import'; readonly source: NodeId; readonly target: NodeId; }
/**
 * Constant for semantic zoom.
 */
export const SEMANTIC_ZOOM = { min: 0.6, max: 1.6 } as const;
const precedence: readonly HitTargetKind[] = ['handle', 'qualifier', 'label', 'edge', 'node', 'group', 'canvas'];
/**
 * Returns hit-test precedence for graph interaction targeting.
 */
export function hitPrecedence(kind: HitTargetKind): number { return precedence.indexOf(kind); }
/**
 * Defines the gesture contract shape.
 */
export interface GestureContract { readonly dragThresholdCssPx: 4; readonly touchTargetCssPx: 44; readonly wheelOverViewportOnly: true; readonly geometricZoomIsNotHistory: true; readonly doubleActivationIsNonMutatingBeforeOpen: true; }
/**
 * Constant for gesture contract.
 */
export const GESTURE_CONTRACT: GestureContract = { dragThresholdCssPx: 4, touchTargetCssPx: 44, wheelOverViewportOnly: true, geometricZoomIsNotHistory: true, doubleActivationIsNonMutatingBeforeOpen: true };
