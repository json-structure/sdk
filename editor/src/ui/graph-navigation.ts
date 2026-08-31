import type { CameraState, HitTargetKind } from '../graph.js';
import { hitPrecedence, SEMANTIC_ZOOM } from '../graph.js';
import type { GraphNode } from './helpers.js';
import type { NavigationEntry, SelectionIdentity } from '../selection.js';

export interface GraphPoint { readonly x: number; readonly y: number; }
export interface GraphRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export type SemanticZoomLevel = 'overview' | 'labels' | 'detail';

export interface GraphHit<T = string> { readonly kind: HitTargetKind; readonly id: T; readonly distance?: number; }

export interface MinimapData {
  readonly content: GraphRect;
  readonly viewport: GraphRect;
  readonly nodes: readonly GraphRect[];
}

export interface GraphNavigationState {
  readonly camera: CameraState;
  readonly semanticZoom: SemanticZoomLevel;
  readonly selection?: SelectionIdentity;
  readonly history: readonly NavigationEntry[];
  readonly historyIndex: number;
}

export interface GraphNavigationOptions {
  readonly viewport?: GraphRect;
  readonly content?: GraphRect;
  readonly camera?: CameraState;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly historyLimit?: number;
}

const DEFAULT_VIEWPORT: GraphRect = { x: 0, y: 0, width: 800, height: 600 };
const DEFAULT_CONTENT: GraphRect = { x: 0, y: 0, width: 1, height: 1 };
const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };

/** Pure graph navigation state and geometry controller. */
export class GraphNavigationController {
  private viewport: GraphRect;
  private content: GraphRect;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly historyLimit: number;
  private camera: CameraState;
  private selection: SelectionIdentity | undefined;
  private history: NavigationEntry[] = [];
  private historyIndex = -1;

  public constructor(options: GraphNavigationOptions = {}) {
    this.viewport = options.viewport ?? DEFAULT_VIEWPORT;
    this.content = options.content ?? DEFAULT_CONTENT;
    this.minZoom = options.minZoom ?? 0.1;
    this.maxZoom = options.maxZoom ?? 4;
    const initialCamera = options.camera ?? DEFAULT_CAMERA;
    this.camera = { ...initialCamera, zoom: this.clampZoom(initialCamera.zoom) };
    this.historyLimit = Math.max(1, options.historyLimit ?? 50);
  }

  public snapshot(): GraphNavigationState {
    return { camera: { ...this.camera }, semanticZoom: semanticZoomForScale(this.camera.zoom), selection: this.selection, history: [...this.history], historyIndex: this.historyIndex };
  }

  public setViewport(viewport: GraphRect): GraphNavigationState {
    this.viewport = { ...viewport };
    return this.snapshot();
  }

  public setContent(content: GraphRect): GraphNavigationState {
    this.content = { ...content };
    return this.snapshot();
  }

  public setSelection(selection: SelectionIdentity | undefined): GraphNavigationState {
    this.selection = selection;
    return this.snapshot();
  }

  /** Keeps a selection when its identity is still represented by the new projection. */
  public reconcileSelection(nodes: readonly Pick<GraphNode, 'id' | 'pointer'>[]): GraphNavigationState {
    if (!this.selection) return this.snapshot();
    const exists = nodes.some((node) => node.id === this.selection?.nodeId || node.pointer === this.selection?.pointer);
    if (!exists) this.selection = undefined;
    return this.snapshot();
  }

  public wheelZoom(pointer: GraphPoint, deltaY: number): GraphNavigationState {
    const factor = Math.exp(-deltaY * 0.0015);
    const nextZoom = this.clampZoom(this.camera.zoom * factor);
    const world = this.screenToWorld(pointer);
    this.camera = { x: pointer.x - world.x * nextZoom, y: pointer.y - world.y * nextZoom, zoom: nextZoom };
    return this.snapshot();
  }

  public pan(delta: GraphPoint): GraphNavigationState {
    this.camera = { ...this.camera, x: this.camera.x + delta.x, y: this.camera.y + delta.y };
    return this.snapshot();
  }

  public fit(bounds: GraphRect = this.content, padding = 32): GraphNavigationState {
    const availableWidth = Math.max(1, this.viewport.width - padding * 2);
    const availableHeight = Math.max(1, this.viewport.height - padding * 2);
    const zoom = this.clampZoom(Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)));
    this.camera = { zoom, x: this.viewport.x + (this.viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: this.viewport.y + (this.viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom };
    return this.snapshot();
  }

  public reveal(bounds: GraphRect, padding = 48): GraphNavigationState {
    const visible = this.worldToScreenRect(bounds);
    let next = { ...this.camera };
    if (visible.width > this.viewport.width - padding * 2 || visible.height > this.viewport.height - padding * 2) {
      const zoom = this.clampZoom(Math.min((this.viewport.width - padding * 2) / Math.max(1, bounds.width), (this.viewport.height - padding * 2) / Math.max(1, bounds.height)));
      next = { ...next, zoom };
    }
    const projected = { x: bounds.x * next.zoom + next.x, y: bounds.y * next.zoom + next.y };
    next = { ...next, x: next.x + this.viewport.x + padding - projected.x, y: next.y + this.viewport.y + padding - projected.y };
    this.camera = next;
    return this.snapshot();
  }

  public navigate(selection: SelectionIdentity, mode: NavigationEntry['mode'] = 'graph'): GraphNavigationState {
    const entry: NavigationEntry = { selection, mode };
    this.selection = selection;
    this.history = this.historyIndex >= 0 ? this.history.slice(0, this.historyIndex + 1) : [];
    this.history.push(entry);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.historyIndex = this.history.length - 1;
    return this.snapshot();
  }

  public back(): GraphNavigationState {
    if (this.historyIndex > 0) this.historyIndex -= 1;
    this.selection = this.history[this.historyIndex]?.selection;
    return this.snapshot();
  }

  public forward(): GraphNavigationState {
    if (this.historyIndex < this.history.length - 1) this.historyIndex += 1;
    this.selection = this.history[this.historyIndex]?.selection;
    return this.snapshot();
  }

  public sortHits<T>(hits: readonly GraphHit<T>[]): readonly GraphHit<T>[] {
    return [...hits].sort((a, b) => hitPrecedence(a.kind) - hitPrecedence(b.kind) || (a.distance ?? 0) - (b.distance ?? 0));
  }

  public minimap(nodes: readonly GraphRect[] = []): MinimapData {
    const viewport = this.screenToWorldRect(this.viewport);
    return { content: { ...this.content }, viewport, nodes: nodes.map((node) => ({ ...node })) };
  }

  public navigateMinimap(point: GraphPoint, minimap: GraphRect): GraphNavigationState {
    const world = { x: this.content.x + ((point.x - minimap.x) / Math.max(1, minimap.width)) * this.content.width, y: this.content.y + ((point.y - minimap.y) / Math.max(1, minimap.height)) * this.content.height };
    this.camera = { ...this.camera, x: this.viewport.x + this.viewport.width / 2 - world.x * this.camera.zoom, y: this.viewport.y + this.viewport.height / 2 - world.y * this.camera.zoom };
    return this.snapshot();
  }

  public worldToScreen(pointOrRect: GraphPoint): GraphPoint;
  public worldToScreen(pointOrRect: GraphRect): GraphRect;
  public worldToScreen(pointOrRect: GraphPoint | GraphRect): GraphPoint | GraphRect {
    if ('width' in pointOrRect) return { x: pointOrRect.x * this.camera.zoom + this.camera.x, y: pointOrRect.y * this.camera.zoom + this.camera.y, width: pointOrRect.width * this.camera.zoom, height: pointOrRect.height * this.camera.zoom };
    return { x: pointOrRect.x * this.camera.zoom + this.camera.x, y: pointOrRect.y * this.camera.zoom + this.camera.y };
  }

  public screenToWorld(point: GraphPoint): GraphPoint {
    return { x: (point.x - this.camera.x) / this.camera.zoom, y: (point.y - this.camera.y) / this.camera.zoom };
  }

  private worldToScreenRect(rect: GraphRect): GraphRect {
    return { x: rect.x * this.camera.zoom + this.camera.x, y: rect.y * this.camera.zoom + this.camera.y, width: rect.width * this.camera.zoom, height: rect.height * this.camera.zoom };
  }

  private screenToWorldRect(rect: GraphRect): GraphRect {
    const origin = this.screenToWorld(rect);
    return { x: origin.x, y: origin.y, width: rect.width / this.camera.zoom, height: rect.height / this.camera.zoom };
  }

  private clampZoom(zoom: number): number { return Math.min(this.maxZoom, Math.max(this.minZoom, zoom)); }
}

export function semanticZoomForScale(zoom: number): SemanticZoomLevel {
  if (zoom < SEMANTIC_ZOOM.min) return 'overview';
  if (zoom > SEMANTIC_ZOOM.max) return 'detail';
  return 'labels';
}