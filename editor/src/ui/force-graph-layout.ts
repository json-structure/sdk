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

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

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

export type ForceGraphLayoutMode = 'force' | 'relations' | 'extends' | 'namespaces' | 'neighborhood' | 'imports';

export interface ForceGraphLayoutOptions {
  readonly cacheKey?: string;
  readonly mode?: ForceGraphLayoutMode;
  readonly focusNodeId?: string;
  readonly direction?: 'outgoing' | 'incoming' | 'both';
}

export interface ForceGraphHit {
  readonly id: string;
  readonly distance: number;
}

export interface ForceGraphOverlapStats {
  readonly passes: number;
  readonly candidatePairs: number;
  readonly movedPairs: number;
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
const nodeGap = 12;

/** Persistent, deterministic force layout for the interactive graph surface. */
export class ForceGraphLayout {
  private nodes: LayoutNode[] = [];
  private links: LayoutLink[] = [];
  private topologyKey = '';
  private layoutArea: ForceGraphBounds = { width: 900, height: 620 };
  private activeCacheKey = 'default';
  private readonly positionCache = new Map<string, Map<string, ForceGraphPosition>>();
  private readonly pinnedPositions = new Map<string, { readonly x: number; readonly y: number }>();
  private tickListener: (() => void) | undefined;
  private overlapStatsValue: ForceGraphOverlapStats = { passes: 0, candidatePairs: 0, movedPairs: 0 };
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

  public reconcile(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: ForceGraphLayoutOptions = {}): readonly ForceGraphPosition[] {
    const orderedNodes = [...new Map(nodes.map((node) => [node.id, node])).values()].sort((left, right) => left.id.localeCompare(right.id));
    const orderedEdges = [...edges].sort((left, right) => left.id.localeCompare(right.id) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
    const cacheKey = options.cacheKey ?? 'default';
    const mode = options.mode ?? 'force';
    const topologyKey = `${cacheKey}\u0002${mode}\u0002${options.focusNodeId ?? ''}\u0002${options.direction ?? ''}\u0002${orderedNodes.map((node) => node.id).join('\u0000')}\u0001${orderedEdges.map((edge) => `${edge.id}:${edge.from}:${edge.to}`).join('\u0000')}`;
    if (topologyKey === this.topologyKey) return this.positions();

    this.cacheCurrentPositions();
    this.activeCacheKey = cacheKey;
    const previous = this.positionCache.get(cacheKey) ?? new Map<string, ForceGraphPosition>();
    const restoresCompleteCache = orderedNodes.length > 0 && orderedNodes.every((node) => previous.has(node.id));
    this.layoutArea = layoutBounds(orderedNodes.length);
    const deterministic = deterministicPositions(orderedNodes, orderedEdges, options, this.layoutArea);
    this.nodes = orderedNodes.map((node, index) => {
      const existing = previous.get(node.id);
      const pinned = this.pinnedPositions.get(node.id);
      const generated = deterministic.get(node.id) ?? seededPosition(node.id, index, nodes.length, this.layoutArea);
      const position = pinned ?? existing ?? generated;
      return {
        id: node.id,
        kind: node.kind,
        width: nodeWidth,
        height: nodeHeight,
        x: position.x,
        y: position.y,
        vx: 0,
        vy: 0,
        ...(pinned || existing?.pinned ? { fx: position.x, fy: position.y } : {}),
      };
    });
    const nodeIds = new Set(this.nodes.map((node) => node.id));
    this.links = orderedEdges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
      .map((edge) => ({ id: edge.id, kind: edge.kind, source: edge.from, target: edge.to }));
    this.topologyKey = topologyKey;
    this.configureForces();
    this.simulation.nodes(this.nodes);
    this.linkForce.links(this.links);
    this.simulation.alpha(1).alphaTarget(0).stop();
    if (mode === 'force') this.simulation.tick(orderedNodes.length > 500 ? 40 : 220);
    this.clampNodes();
    if (restoresCompleteCache) this.overlapStatsValue = { passes: 0, candidatePairs: 0, movedPairs: 0 };
    else this.resolveOverlaps();
    this.cacheCurrentPositions();
    return this.positions();
  }

  public positions(): readonly ForceGraphPosition[] {
    return this.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, pinned: isPinned(node) }));
  }

  public position(id: string): ForceGraphPosition | undefined {
    const node = this.nodes.find((candidate) => candidate.id === id);
    return node ? toPosition(node) : undefined;
  }

  /** Returns the nearest node under a world-space point, with deterministic tie-breaking. */
  public hitTest(point: GraphPoint, padding = 0): ForceGraphPosition | undefined {
    const hit = hitTestGraphNodes(this.positions(), point, padding)[0];
    return hit ? this.position(hit.id) : undefined;
  }

  public hitTestNodes(point: GraphPoint, padding = 0): readonly ForceGraphHit[] {
    return hitTestGraphNodes(this.positions(), point, padding);
  }

  public hitTestEdges(point: GraphPoint, edges: readonly GraphEdge[], tolerance = 12): readonly ForceGraphHit[] {
    return hitTestGraphEdges(point, edges, new Map(this.positions().map((position) => [position.id, position])), tolerance);
  }

  public hitTestEdge(point: GraphPoint, edges: readonly GraphEdge[], tolerance = 12): ForceGraphHit | undefined {
    return this.hitTestEdges(point, edges, tolerance)[0];
  }

  public contentBounds(): ForceGraphBounds {
    if (this.nodes.length === 0) return { width: 1, height: 1 };
    return {
      width: Math.max(1, Math.ceil(Math.max(...this.nodes.map((node) => node.x + node.width)) + layoutPadding)),
      height: Math.max(1, Math.ceil(Math.max(...this.nodes.map((node) => node.y + node.height)) + layoutPadding)),
    };
  }

  public overlapStats(): ForceGraphOverlapStats {
    return { ...this.overlapStatsValue };
  }

  public setTickListener(listener: (() => void) | undefined): void {
    this.tickListener = listener;
  }

  public startDrag(id: string): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    node.fx = node.x;
    node.fy = node.y;
    node.vx = 0;
    node.vy = 0;
  }

  public drag(id: string, point: { readonly x: number; readonly y: number }): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    node.fx = clamp(point.x, layoutPadding, this.layoutArea.width - node.width - layoutPadding);
    node.fy = clamp(point.y, layoutPadding, this.layoutArea.height - node.height - layoutPadding);
    node.x = node.fx;
    node.y = node.fy;
    node.vx = 0;
    node.vy = 0;
    this.pinnedPositions.set(id, { x: node.x, y: node.y });
    this.cacheCurrentPositions();
    this.tickListener?.();
  }

  public endDrag(id: string, pin = true): void {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    if (!pin) {
      node.fx = null;
      node.fy = null;
      this.pinnedPositions.delete(id);
    } else {
      this.pinnedPositions.set(id, { x: node.x, y: node.y });
    }
    node.vx = 0;
    node.vy = 0;
    this.simulation.stop();
    this.cacheCurrentPositions();
    this.tickListener?.();
  }

  public relayout(): void {
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
      node.vx = 0;
      node.vy = 0;
    }
    this.pinnedPositions.clear();
    this.positionCache.delete(this.activeCacheKey);
    this.simulation.alphaTarget(0).alpha(1).restart();
  }

  public settle(iterations = 160): readonly ForceGraphPosition[] {
    this.simulation.stop();
    this.simulation.tick(iterations);
    this.clampNodes();
    this.resolveOverlaps();
    this.cacheCurrentPositions();
    this.tickListener?.();
    return this.positions();
  }

  public dispose(): void {
    this.tickListener = undefined;
    this.simulation.stop();
  }

  private configureForces(): void {
    const centerX = this.layoutArea.width / 2;
    const centerY = this.layoutArea.height / 2;
    const largeGraph = this.nodes.length > 500;
    this.simulation
      .force('charge', forceManyBody<LayoutNode>().strength(largeGraph ? -260 : -650).distanceMax(largeGraph ? 500 : 950))
      .force('collision', forceCollide<LayoutNode>().radius(88).strength(0.95).iterations(largeGraph ? 1 : 3))
      .force('center', forceCenter<LayoutNode>(centerX, centerY))
      .force('x', forceX<LayoutNode>(centerX).strength(0.025))
      .force('y', forceY<LayoutNode>(centerY).strength(0.035));
  }

  private clampNodes(): void {
    for (const node of this.nodes) {
      node.x = clamp(node.x, layoutPadding, this.layoutArea.width - node.width - layoutPadding);
      node.y = clamp(node.y, layoutPadding, this.layoutArea.height - node.height - layoutPadding);
      if (node.fx !== null && node.fx !== undefined) node.fx = node.x;
      if (node.fy !== null && node.fy !== undefined) node.fy = node.y;
    }
  }

  private resolveOverlaps(): void {
    const nodeCount = this.nodes.length;
    this.overlapStatsValue = { passes: 0, candidatePairs: 0, movedPairs: 0 };
    if (nodeCount < 2) {
      this.clampNodes();
      return;
    }
    // The broad phase keeps overlap resolution linear in the number of nearby
    // nodes. A fixed upper bound is important because a dense imported graph
    // must never turn a refresh into an unbounded all-pairs relaxation.
    const maximumPasses = nodeCount > 128 ? 8 : 24;
    const cellSize = nodeWidth + nodeGap * 2;
    let candidatePairs = 0;
    let movedPairs = 0;
    for (let pass = 0; pass < maximumPasses; pass += 1) {
      this.overlapStatsValue = { ...this.overlapStatsValue, passes: pass + 1 };
      const cells = new Map<string, number[]>();
      for (let index = 0; index < nodeCount; index += 1) {
        const node = this.nodes[index]!;
        const minX = Math.floor((node.x - nodeGap) / cellSize);
        const maxX = Math.floor((node.x + node.width + nodeGap) / cellSize);
        const minY = Math.floor((node.y - nodeGap) / cellSize);
        const maxY = Math.floor((node.y + node.height + nodeGap) / cellSize);
        for (let cellX = minX; cellX <= maxX; cellX += 1) {
          for (let cellY = minY; cellY <= maxY; cellY += 1) {
            const key = `${cellX}:${cellY}`;
            const members = cells.get(key) ?? [];
            members.push(index);
            cells.set(key, members);
          }
        }
      }

      let changed = false;
      const examined = new Set<number>();
      for (const members of cells.values()) {
        for (let leftMember = 0; leftMember < members.length; leftMember += 1) {
          const leftIndex = members[leftMember]!;
          for (let rightMember = leftMember + 1; rightMember < members.length; rightMember += 1) {
            const rightIndex = members[rightMember]!;
            const pair = leftIndex < rightIndex
              ? leftIndex * nodeCount + rightIndex
              : rightIndex * nodeCount + leftIndex;
            if (examined.has(pair)) continue;
            examined.add(pair);
            candidatePairs += 1;
            if (separateOverlappingNodes(this.nodes[leftIndex]!, this.nodes[rightIndex]!)) {
              changed = true;
              movedPairs += 1;
            }
          }
        }
      }
      this.clampNodes();
      if (!changed) break;
    }
    this.overlapStatsValue = { ...this.overlapStatsValue, candidatePairs, movedPairs };
    this.clampNodes();
  }

  private cacheCurrentPositions(): void {
    if (this.nodes.length === 0) return;
    this.positionCache.set(this.activeCacheKey, new Map(this.nodes.map((node) => [node.id, toPosition(node)])));
  }
}

export function hitTestGraphNodes(positions: readonly ForceGraphPosition[], point: GraphPoint, padding = 0): readonly ForceGraphHit[] {
  const safePadding = Math.max(0, padding);
  return positions
    .filter((position) => point.x >= position.x - safePadding && point.x <= position.x + position.width + safePadding && point.y >= position.y - safePadding && point.y <= position.y + position.height + safePadding)
    .map((position) => ({ id: position.id, distance: distanceToRect(point, position) }))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}

export function hitTestGraphNode(positions: readonly ForceGraphPosition[], point: GraphPoint, padding = 0): ForceGraphHit | undefined {
  return hitTestGraphNodes(positions, point, padding)[0];
}

export function hitTestGraphEdges(point: GraphPoint, edges: readonly GraphEdge[], positions: ReadonlyMap<string, ForceGraphPosition>, tolerance = 12): readonly ForceGraphHit[] {
  const safeTolerance = Math.max(0, tolerance);
  return edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    return from && to ? { id: edge.id, distance: graphEdgeDistance(point, from, to) } : undefined;
  }).filter((hit): hit is ForceGraphHit => hit !== undefined && hit.distance <= safeTolerance)
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}

export function hitTestGraphEdge(point: GraphPoint, edges: readonly GraphEdge[], positions: ReadonlyMap<string, ForceGraphPosition>, tolerance = 12): ForceGraphHit | undefined {
  return hitTestGraphEdges(point, edges, positions, tolerance)[0];
}

export function graphEdgeDistance(point: GraphPoint, from: ForceGraphPosition, to: ForceGraphPosition): number {
  if (from.id !== to.id) {
    const start = edgeEndpoint(from, to);
    const end = edgeEndpoint(to, from);
    return distanceToSegment(point, start, end);
  }
  const start = { x: from.x + from.width * 0.72, y: from.y };
  const controlOne = { x: from.x + from.width + 52, y: from.y - 58 };
  const controlTwo = { x: from.x + from.width + 68, y: from.y + from.height * 0.5 };
  const end = { x: from.x + from.width, y: from.y + from.height * 0.45 };
  let previous = start;
  let nearest = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= 24; step += 1) {
    const t = step / 24;
    const next = cubicPoint(start, controlOne, controlTwo, end, t);
    nearest = Math.min(nearest, distanceToSegment(point, previous, next));
    previous = next;
  }
  return nearest;
}

function edgeEndpoint(from: ForceGraphPosition, to: ForceGraphPosition): GraphPoint {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const deltaX = toCenter.x - fromCenter.x;
  const deltaY = toCenter.y - fromCenter.y;
  const scale = rectangleIntersectionScale(deltaX, deltaY, from.width, from.height);
  return { x: fromCenter.x + deltaX * scale, y: fromCenter.y + deltaY * scale };
}

function cubicPoint(start: GraphPoint, controlOne: GraphPoint, controlTwo: GraphPoint, end: GraphPoint, t: number): GraphPoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlOne.x + 3 * inverse * t ** 2 * controlTwo.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlOne.y + 3 * inverse * t ** 2 * controlTwo.y + t ** 3 * end.y,
  };
}

function distanceToRect(point: GraphPoint, position: ForceGraphPosition): number {
  const nearestX = clamp(point.x, position.x, position.x + position.width);
  const nearestY = clamp(point.y, position.y, position.y + position.height);
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function distanceToSegment(point: GraphPoint, start: GraphPoint, end: GraphPoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const ratio = lengthSquared === 0 ? 0 : clamp(((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + ratio * deltaX), point.y - (start.y + ratio * deltaY));
}

export function graphEdgePath(from: ForceGraphPosition, to: ForceGraphPosition, lane = 0): { readonly path: string; readonly labelX: number; readonly labelY: number } {
  if (from.id === to.id) {
    const laneOffset = Math.max(0, lane) * 18;
    const startX = from.x + from.width * 0.72;
    const startY = from.y;
    const endX = from.x + from.width;
    const endY = from.y + from.height * 0.45;
    return {
      path: `M${startX} ${startY} C${from.x + from.width + 52 + laneOffset} ${from.y - 58 - laneOffset}, ${from.x + from.width + 68 + laneOffset} ${from.y + from.height * 0.5 + laneOffset}, ${endX} ${endY}`,
      labelX: from.x + from.width + 32 + laneOffset,
      labelY: from.y - 16 - laneOffset,
    };
  }
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const delta = { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y };
  const startScale = rectangleIntersectionScale(delta.x, delta.y, from.width, from.height);
  const endScale = rectangleIntersectionScale(delta.x, delta.y, to.width, to.height);
  const start = { x: fromCenter.x + delta.x * startScale, y: fromCenter.y + delta.y * startScale };
  const end = { x: toCenter.x - delta.x * endScale, y: toCenter.y - delta.y * endScale };
  if (lane === 0) return { path: `M${start.x} ${start.y} L${end.x} ${end.y}`, labelX: (start.x + end.x) / 2, labelY: (start.y + end.y) / 2 - 6 };
  const length = Math.max(1, Math.hypot(delta.x, delta.y));
  const normal = { x: -delta.y / length, y: delta.x / length };
  const curve = lane * 22;
  const control = { x: (start.x + end.x) / 2 + normal.x * curve, y: (start.y + end.y) / 2 + normal.y * curve };
  return {
    path: `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`,
    labelX: (start.x + 2 * control.x + end.x) / 4,
    labelY: (start.y + 2 * control.y + end.y) / 4 - 6,
  };
}

function deterministicPositions(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: ForceGraphLayoutOptions, bounds: ForceGraphBounds): ReadonlyMap<string, GraphPoint> {
  const mode = options.mode ?? 'force';
  if (mode === 'force') return new Map();
  if (mode === 'neighborhood' && options.focusNodeId) return neighborhoodPositions(nodes, edges, options.focusNodeId, bounds);
  if (mode === 'namespaces') return namespaceGridPositions(nodes, bounds);
  return layeredPositions(nodes, edges, mode === 'extends');
}

function namespaceGridPositions(nodes: readonly GraphNode[], bounds: ForceGraphBounds): ReadonlyMap<string, GraphPoint> {
  const result = new Map<string, GraphPoint>();
  const document = nodes.find((node) => node.kind === 'document');
  if (document) result.set(document.id, { x: bounds.width / 2 - nodeWidth / 2, y: layoutPadding });
  const remaining = nodes.filter((node) => node !== document);
  const columns = Math.max(1, Math.ceil(Math.sqrt(remaining.length)));
  remaining.forEach((node, index) => {
    result.set(node.id, {
      x: layoutPadding + index % columns * 230,
      y: layoutPadding + (document ? 110 : 0) + Math.floor(index / columns) * 120,
    });
  });
  return result;
}

function layeredPositions(nodes: readonly GraphNode[], edges: readonly GraphEdge[], vertical: boolean): ReadonlyMap<string, GraphPoint> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const rank = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id).sort();
  if (queue.length === 0) queue.push(...nodes.map((node) => node.id).sort().slice(0, 1));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    const nextRank = (rank.get(id) ?? 0) + 1;
    for (const target of [...(outgoing.get(id) ?? [])].sort()) {
      rank.set(target, Math.max(rank.get(target) ?? 0, nextRank));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);
  const levels = new Map<number, GraphNode[]>();
  for (const node of nodes) levels.set(rank.get(node.id) ?? 0, [...(levels.get(rank.get(node.id) ?? 0) ?? []), node]);
  const result = new Map<string, GraphPoint>();
  for (const [level, members] of [...levels.entries()].sort(([left], [right]) => left - right)) {
    members.sort((left, right) => left.id.localeCompare(right.id));
    members.forEach((node, index) => {
      result.set(node.id, vertical
        ? { x: layoutPadding + index * 230, y: layoutPadding + level * 130 }
        : { x: layoutPadding + level * 250, y: layoutPadding + index * 105 });
    });
  }
  return result;
}

function neighborhoodPositions(nodes: readonly GraphNode[], edges: readonly GraphEdge[], focusNodeId: string, bounds: ForceGraphBounds): ReadonlyMap<string, GraphPoint> {
  const center = { x: bounds.width / 2 - nodeWidth / 2, y: bounds.height / 2 - nodeHeight / 2 };
  const result = new Map<string, GraphPoint>([[focusNodeId, center]]);
  const incoming = new Set(edges.filter((edge) => edge.to === focusNodeId && edge.from !== focusNodeId).map((edge) => edge.from));
  const outgoing = new Set(edges.filter((edge) => edge.from === focusNodeId && edge.to !== focusNodeId).map((edge) => edge.to));
  const placeSide = (ids: readonly string[], side: -1 | 1): void => {
    ids.forEach((id, index) => {
      const offset = (index - (ids.length - 1) / 2) * 105;
      result.set(id, { x: center.x + side * 280, y: center.y + offset });
    });
  };
  placeSide([...incoming].filter((id) => !outgoing.has(id)).sort(), -1);
  placeSide([...outgoing].filter((id) => !incoming.has(id)).sort(), 1);
  const reciprocal = [...incoming].filter((id) => outgoing.has(id)).sort();
  reciprocal.forEach((id, index) => result.set(id, { x: center.x + (index - (reciprocal.length - 1) / 2) * 210, y: center.y - 170 }));
  const context = nodes.filter((node) => !result.has(node.id)).sort((left, right) => left.id.localeCompare(right.id));
  context.forEach((node, index) => {
    const angle = index / Math.max(1, context.length) * Math.PI * 2;
    result.set(node.id, { x: center.x + Math.cos(angle) * Math.min(bounds.width, bounds.height) * 0.4, y: center.y + Math.sin(angle) * Math.min(bounds.width, bounds.height) * 0.4 });
  });
  return result;
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
  if (Math.abs(deltaX) < Number.EPSILON && Math.abs(deltaY) < Number.EPSILON) return 0;
  const horizontal = Math.abs(deltaX) < Number.EPSILON ? Number.POSITIVE_INFINITY : width / 2 / Math.abs(deltaX);
  const vertical = Math.abs(deltaY) < Number.EPSILON ? Number.POSITIVE_INFINITY : height / 2 / Math.abs(deltaY);
  return Math.min(horizontal, vertical);
}

function toPosition(node: LayoutNode): ForceGraphPosition {
  return { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, pinned: isPinned(node) };
}

function isPinned(node: LayoutNode): boolean {
  return node.fx !== null && node.fx !== undefined || node.fy !== null && node.fy !== undefined;
}

function shiftNode(node: LayoutNode, horizontal: boolean, amount: number): void {
  if (horizontal) node.x += amount;
  else node.y += amount;
}
function separateOverlappingNodes(left: LayoutNode, right: LayoutNode): boolean {
  const overlapX = Math.min(left.x + left.width + nodeGap, right.x + right.width + nodeGap) - Math.max(left.x - nodeGap, right.x - nodeGap);
  const overlapY = Math.min(left.y + left.height + nodeGap, right.y + right.height + nodeGap) - Math.max(left.y - nodeGap, right.y - nodeGap);
  if (overlapX <= 0 || overlapY <= 0) return false;
  const leftMovable = !isPinned(left);
  const rightMovable = !isPinned(right);
  if (!leftMovable && !rightMovable) return false;
  const horizontal = overlapX <= overlapY;
  const leftCenter = horizontal ? left.x + left.width / 2 : left.y + left.height / 2;
  const rightCenter = horizontal ? right.x + right.width / 2 : right.y + right.height / 2;
  const direction = rightCenter >= leftCenter ? 1 : -1;
  const amount = (horizontal ? overlapX : overlapY) + 0.5;
  if (leftMovable && rightMovable) {
    shiftNode(left, horizontal, -direction * amount / 2);
    shiftNode(right, horizontal, direction * amount / 2);
  } else if (rightMovable) {
    shiftNode(right, horizontal, direction * amount);
  } else {
    shiftNode(left, horizontal, -direction * amount);
  }
  return true;
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
