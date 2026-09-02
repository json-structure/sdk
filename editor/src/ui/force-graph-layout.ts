import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode } from './helpers.js';

export interface ForceGraphPosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pinned: boolean;
}

export interface ForceGraphBounds {
  readonly width: number;
  readonly height: number;
}

interface LayoutNode extends SimulationNodeDatum {
  readonly id: string;
  readonly kind: GraphNode['kind'];
  readonly width: number;
  readonly height: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  readonly id: string;
  readonly kind: GraphEdge['kind'];
  source: string | LayoutNode;
  target: string | LayoutNode;
}

const nodeWidth = 150;
const nodeHeight = 50;
const layoutPadding = 40;

/** Persistent, deterministic force layout for the interactive graph surface. */
export class ForceGraphLayout {
  private nodes: LayoutNode[] = [];
  private links: LayoutLink[] = [];
  private topologyKey = '';
  private bounds: ForceGraphBounds = { width: 900, height: 620 };
  private tickListener: (() => void) | undefined;
  private readonly linkForce = forceLink<LayoutNode, LayoutLink>()
    .id((node) => node.id)
    .distance((link) => link.kind === 'inheritance' ? 145 : 190)
    .strength((link) => link.kind === 'inheritance' ? 0.5 : 0.3);
  private readonly simulation: Simulation<LayoutNode, LayoutLink> = forceSimulation<LayoutNode, LayoutLink>([])
    .alphaDecay(0.045)
    .velocityDecay(0.38)
    .force('link', this.linkForce)
    .force('charge', forceManyBody<LayoutNode>().strength(-650).distanceMax(950))
    .force('collision', forceCollide<LayoutNode>().radius(88).strength(0.95).iterations(3))
    .force('center', forceCenter<LayoutNode>(450, 310))
    .force('x', forceX<LayoutNode>(450).strength(0.025))
    .force('y', forceY<LayoutNode>(310).strength(0.035))
    .on('tick', () => {
      this.clampNodes();
      this.tickListener?.();
    })
    .stop();

  public reconcile(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): readonly ForceGraphPosition[] {
    const topologyKey = `${nodes.map((node) => node.id).join('\u0000')}\u0001${edges.map((edge) => `${edge.id}:${edge.from}:${edge.to}`).join('\u0000')}`;
    if (topologyKey === this.topologyKey) return this.positions();

    const previous = new Map(this.nodes.map((node) => [node.id, node]));
    this.bounds = layoutBounds(nodes.length);
    this.nodes = nodes.map((node, index) => {
      const existing = previous.get(node.id);
      if (existing) return existing;
      const seed = seededPosition(node.id, index, nodes.length, this.bounds);
      return { id: node.id, kind: node.kind, width: nodeWidth, height: nodeHeight, x: seed.x, y: seed.y, vx: 0, vy: 0 };
    });
    const nodeIds = new Set(this.nodes.map((node) => node.id));
    this.links = edges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
      .map((edge) => ({ id: edge.id, kind: edge.kind, source: edge.from, target: edge.to }));
    this.topologyKey = topologyKey;
    this.configureForces();
    this.simulation.nodes(this.nodes);
    this.linkForce.links(this.links);
    this.simulation.alpha(1).alphaTarget(0).stop();
    this.simulation.tick(220);
    this.clampNodes();
    return this.positions();
  }

  public positions(): readonly ForceGraphPosition[] {
    return this.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, pinned: node.fx !== null && node.fx !== undefined }));
  }

  public position(id: string): ForceGraphPosition | undefined {
    const node = this.nodes.find((candidate) => candidate.id === id);
    return node ? { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, pinned: node.fx !== null && node.fx !== undefined } : undefined;
  }

  public contentBounds(): ForceGraphBounds {
    return { ...this.bounds };
  }

  public setTickListener(listener: (() => void) | undefined): void {
    this.tickListener = listener;
  }

  public startDrag(id: string): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    node.fx = node.x;
    node.fy = node.y;
    this.simulation.alphaTarget(0.22).restart();
  }

  public drag(id: string, point: { readonly x: number; readonly y: number }): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    node.fx = clamp(point.x, layoutPadding, this.bounds.width - node.width - layoutPadding);
    node.fy = clamp(point.y, layoutPadding, this.bounds.height - node.height - layoutPadding);
    node.x = node.fx;
    node.y = node.fy;
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.35)).restart();
    this.tickListener?.();
  }

  public endDrag(id: string, pin = true): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    if (!pin) {
      node.fx = null;
      node.fy = null;
    }
    this.simulation.alphaTarget(0).alpha(Math.max(this.simulation.alpha(), 0.16)).restart();
  }

  public relayout(): void {
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
      node.vx = 0;
      node.vy = 0;
    }
    this.simulation.alphaTarget(0).alpha(1).restart();
  }

  public settle(iterations = 160): readonly ForceGraphPosition[] {
    this.simulation.stop();
    this.simulation.tick(iterations);
    this.clampNodes();
    this.tickListener?.();
    return this.positions();
  }

  public dispose(): void {
    this.tickListener = undefined;
    this.simulation.stop();
  }

  private configureForces(): void {
    const centerX = this.bounds.width / 2;
    const centerY = this.bounds.height / 2;
    this.simulation
      .force('center', forceCenter<LayoutNode>(centerX, centerY))
      .force('x', forceX<LayoutNode>(centerX).strength(0.025))
      .force('y', forceY<LayoutNode>(centerY).strength(0.035));
  }

  private clampNodes(): void {
    for (const node of this.nodes) {
      node.x = clamp(node.x, layoutPadding, this.bounds.width - node.width - layoutPadding);
      node.y = clamp(node.y, layoutPadding, this.bounds.height - node.height - layoutPadding);
      if (node.fx !== null && node.fx !== undefined) node.fx = node.x;
      if (node.fy !== null && node.fy !== undefined) node.fy = node.y;
    }
  }
}

export function graphEdgePath(from: ForceGraphPosition, to: ForceGraphPosition): { readonly path: string; readonly labelX: number; readonly labelY: number } {
  if (from.id === to.id) {
    const startX = from.x + from.width * 0.72;
    const startY = from.y;
    const endX = from.x + from.width;
    const endY = from.y + from.height * 0.45;
    return {
      path: `M${startX} ${startY} C${from.x + from.width + 52} ${from.y - 58}, ${from.x + from.width + 68} ${from.y + from.height * 0.5}, ${endX} ${endY}`,
      labelX: from.x + from.width + 32,
      labelY: from.y - 16,
    };
  }
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const delta = { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y };
  const startScale = rectangleIntersectionScale(delta.x, delta.y, from.width, from.height);
  const endScale = rectangleIntersectionScale(delta.x, delta.y, to.width, to.height);
  const start = { x: fromCenter.x + delta.x * startScale, y: fromCenter.y + delta.y * startScale };
  const end = { x: toCenter.x - delta.x * endScale, y: toCenter.y - delta.y * endScale };
  return { path: `M${start.x} ${start.y} L${end.x} ${end.y}`, labelX: (start.x + end.x) / 2, labelY: (start.y + end.y) / 2 - 6 };
}

function layoutBounds(nodeCount: number): ForceGraphBounds {
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, nodeCount) * 1.35)));
  const rows = Math.max(1, Math.ceil(Math.max(1, nodeCount) / columns));
  return { width: Math.max(900, columns * 230), height: Math.max(620, rows * 170) };
}

function seededPosition(id: string, index: number, total: number, bounds: ForceGraphBounds): { readonly x: number; readonly y: number } {
  const hash = hashString(id);
  const angle = ((hash % 360) / 180) * Math.PI + index * 2.399963229728653;
  const radius = 70 + Math.sqrt((index + 1) / Math.max(1, total)) * Math.min(bounds.width, bounds.height) * 0.34;
  return {
    x: bounds.width / 2 + Math.cos(angle) * radius - nodeWidth / 2,
    y: bounds.height / 2 + Math.sin(angle) * radius - nodeHeight / 2,
  };
}

function rectangleIntersectionScale(deltaX: number, deltaY: number, width: number, height: number): number {
  const horizontal = Math.abs(deltaX) < Number.EPSILON ? Number.POSITIVE_INFINITY : width / 2 / Math.abs(deltaX);
  const vertical = Math.abs(deltaY) < Number.EPSILON ? Number.POSITIVE_INFINITY : height / 2 / Math.abs(deltaY);
  return Math.min(horizontal, vertical);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
