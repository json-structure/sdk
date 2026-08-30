import type { NodeId } from './contracts.js';
export type ProjectionId = 'namespaces' | 'relations' | 'extends' | 'imports';
export type HitTargetKind = 'handle' | 'qualifier' | 'label' | 'edge' | 'node' | 'group' | 'canvas';
export interface CameraState { readonly x: number; readonly y: number; readonly zoom: number; }
export interface GraphProjection { readonly id: ProjectionId; readonly nodes: readonly NodeId[]; readonly edges: readonly GraphEdge[]; }
export interface GraphEdge { readonly id: string; readonly kind: 'relation' | 'qualifier' | 'inheritance' | 'reference' | 'import'; readonly source: NodeId; readonly target: NodeId; }
export const SEMANTIC_ZOOM = { min: 0.6, max: 1.6 } as const;
const precedence: readonly HitTargetKind[] = ['handle', 'qualifier', 'label', 'edge', 'node', 'group', 'canvas'];
export function hitPrecedence(kind: HitTargetKind): number { return precedence.indexOf(kind); }
export interface GestureContract { readonly dragThresholdCssPx: 4; readonly touchTargetCssPx: 44; readonly wheelOverViewportOnly: true; readonly geometricZoomIsNotHistory: true; readonly doubleActivationIsNonMutatingBeforeOpen: true; }
export const GESTURE_CONTRACT: GestureContract = { dragThresholdCssPx: 4, touchTargetCssPx: 44, wheelOverViewportOnly: true, geometricZoomIsNotHistory: true, doubleActivationIsNonMutatingBeforeOpen: true };
