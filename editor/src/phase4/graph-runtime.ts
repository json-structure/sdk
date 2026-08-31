export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface GraphNodeInput {
  readonly id: string;
  readonly namespace?: string;
  readonly label?: string;
  readonly width?: number;
  readonly height?: number;
  readonly position?: GraphPoint;
  readonly pinned?: boolean;
}

export interface GraphEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
}

export interface GraphRuntimeInput {
  readonly nodes: readonly GraphNodeInput[];
  readonly edges: readonly GraphEdgeInput[];
  readonly rootId?: string;
}

export interface LayoutNode extends GraphNodeInput {
  readonly namespace: string;
  readonly position: GraphPoint;
  readonly width: number;
  readonly height: number;
  readonly pinned: boolean;
}

export interface GraphViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type SemanticLevel = 'overview' | 'labels' | 'detail';

export interface VirtualNode extends LayoutNode {
  readonly showLabel: boolean;
  readonly showDetails: boolean;
}

export interface VirtualEdge extends GraphEdgeInput {
  readonly showLabel: boolean;
}

export interface VirtualizedGraph {
  readonly nodes: readonly VirtualNode[];
  readonly edges: readonly VirtualEdge[];
  readonly totalNodeCount: number;
  readonly totalEdgeCount: number;
  readonly truncated: boolean;
}

export interface ViewportOptions {
  readonly semanticLevel?: SemanticLevel;
  readonly padding?: number;
  readonly maxNodes?: number;
}

export interface TraversalOptions {
  readonly direction?: 'outgoing' | 'incoming' | 'both';
  readonly maxDepth?: number;
}

export interface ImpactEntry {
  readonly id: string;
  readonly distance: number;
}

export interface EdgeLabelLane {
  readonly edgeId: string;
  readonly lane: number;
  readonly x: number;
  readonly y: number;
}

export interface GraphPerformanceMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly indexedCellCount: number;
  readonly buildDurationMs: number;
  readonly estimatedBytes: number;
}

export interface PerformanceBudget {
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly maxBuildDurationMs?: number;
  readonly maxEstimatedBytes?: number;
}

export interface BudgetEvaluation {
  readonly withinBudget: boolean;
  readonly violations: readonly string[];
}

const DEFAULT_NAMESPACE = '(default)';
const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;
const COLUMN_GAP = 80;
const ROW_GAP = 32;
const NAMESPACE_GAP = 240;
const CELL_SIZE = 256;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finiteSize(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function intersects(node: LayoutNode, viewport: GraphViewport, padding: number): boolean {
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  return node.position.x + halfWidth >= viewport.x - padding
    && node.position.x - halfWidth <= viewport.x + viewport.width + padding
    && node.position.y + halfHeight >= viewport.y - padding
    && node.position.y - halfHeight <= viewport.y + viewport.height + padding;
}

export class GraphRuntime {
  private readonly nodesById: ReadonlyMap<string, LayoutNode>;
  private readonly edgesById: ReadonlyMap<string, GraphEdgeInput>;
  private readonly outgoing: ReadonlyMap<string, readonly string[]>;
  private readonly incoming: ReadonlyMap<string, readonly string[]>;
  private readonly spatialCells: ReadonlyMap<string, readonly string[]>;
  private readonly metricsValue: GraphPerformanceMetrics;
  readonly rootId: string | undefined;

  constructor(input: GraphRuntimeInput, previous?: GraphRuntime) {
    const started = now();
    this.rootId = input.rootId;
    const inputById = new Map<string, GraphNodeInput>();
    for (const node of input.nodes) {
      if (!node.id || inputById.has(node.id)) {
        throw new Error(`Graph node IDs must be non-empty and unique: ${node.id}`);
      }
      inputById.set(node.id, node);
    }
    if (input.rootId !== undefined && !inputById.has(input.rootId)) {
      throw new Error(`Graph root does not exist: ${input.rootId}`);
    }

    const grouped = new Map<string, GraphNodeInput[]>();
    for (const node of inputById.values()) {
      const namespace = node.namespace ?? DEFAULT_NAMESPACE;
      const group = grouped.get(namespace) ?? [];
      group.push(node);
      grouped.set(namespace, group);
    }

    const laidOut = new Map<string, LayoutNode>();
    const namespaces = [...grouped.keys()].sort(compareText);
    for (let namespaceIndex = 0; namespaceIndex < namespaces.length; namespaceIndex += 1) {
      const namespace = namespaces[namespaceIndex];
      const group = grouped.get(namespace)!;
      group.sort((left, right) => compareText(left.id, right.id));
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.length)));
      for (let nodeIndex = 0; nodeIndex < group.length; nodeIndex += 1) {
        const node = group[nodeIndex];
        const prior = previous?.nodesById.get(node.id);
        const width = finiteSize(node.width, NODE_WIDTH);
        const height = finiteSize(node.height, NODE_HEIGHT);
        const generated = {
          x: NAMESPACE_GAP + namespaceIndex * (columns * (NODE_WIDTH + COLUMN_GAP) + NAMESPACE_GAP)
            + (nodeIndex % columns) * (NODE_WIDTH + COLUMN_GAP),
          y: Math.floor(nodeIndex / columns) * (NODE_HEIGHT + ROW_GAP)
        };
        const position = node.position
          ?? (prior && prior.namespace === namespace ? prior.position : undefined)
          ?? (node.id === input.rootId ? { x: 0, y: 0 } : generated);
        laidOut.set(node.id, {
          ...node,
          namespace,
          width,
          height,
          position: { x: position.x, y: position.y },
          pinned: node.pinned === true || node.position !== undefined || node.id === input.rootId
        });
      }
    }
    this.nodesById = laidOut;

    const edgeMap = new Map<string, GraphEdgeInput>();
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const id of laidOut.keys()) {
      outgoing.set(id, []);
      incoming.set(id, []);
    }
    for (const edge of [...input.edges].sort((left, right) => compareText(left.id, right.id))) {
      if (!edge.id || edgeMap.has(edge.id)) {
        throw new Error(`Graph edge IDs must be non-empty and unique: ${edge.id}`);
      }
      if (!laidOut.has(edge.source) || !laidOut.has(edge.target)) {
        throw new Error(`Graph edge ${edge.id} has a missing endpoint`);
      }
      edgeMap.set(edge.id, edge);
      outgoing.get(edge.source)!.push(edge.target);
      incoming.get(edge.target)!.push(edge.source);
    }
    for (const neighbors of [...outgoing.values(), ...incoming.values()]) {
      neighbors.sort(compareText);
    }
    this.edgesById = edgeMap;
    this.outgoing = outgoing;
    this.incoming = incoming;

    const cells = new Map<string, string[]>();
    for (const node of laidOut.values()) {
      const minX = Math.floor((node.position.x - node.width / 2) / CELL_SIZE);
      const maxX = Math.floor((node.position.x + node.width / 2) / CELL_SIZE);
      const minY = Math.floor((node.position.y - node.height / 2) / CELL_SIZE);
      const maxY = Math.floor((node.position.y + node.height / 2) / CELL_SIZE);
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        for (let cellY = minY; cellY <= maxY; cellY += 1) {
          const key = cellKey(cellX, cellY);
          const members = cells.get(key) ?? [];
          members.push(node.id);
          cells.set(key, members);
        }
      }
    }
    for (const members of cells.values()) {
      members.sort(compareText);
    }
    this.spatialCells = cells;
    this.metricsValue = {
      nodeCount: laidOut.size,
      edgeCount: edgeMap.size,
      indexedCellCount: cells.size,
      buildDurationMs: Math.max(0, now() - started),
      estimatedBytes: laidOut.size * 240 + edgeMap.size * 112
        + [...outgoing.values(), ...incoming.values()].reduce((sum, list) => sum + list.length * 16, 0)
    };
  }

  update(input: GraphRuntimeInput): GraphRuntime {
    return new GraphRuntime(input, this);
  }

  nodes(): readonly LayoutNode[] {
    return [...this.nodesById.values()].sort((left, right) => compareText(left.id, right.id));
  }

  edges(): readonly GraphEdgeInput[] {
    return [...this.edgesById.values()];
  }

  node(id: string): LayoutNode | undefined {
    return this.nodesById.get(id);
  }

  metrics(): GraphPerformanceMetrics {
    return this.metricsValue;
  }

  evaluateBudget(budget: PerformanceBudget): BudgetEvaluation {
    const violations: string[] = [];
    if (budget.maxNodes !== undefined && this.metricsValue.nodeCount > budget.maxNodes) violations.push('nodeCount');
    if (budget.maxEdges !== undefined && this.metricsValue.edgeCount > budget.maxEdges) violations.push('edgeCount');
    if (budget.maxBuildDurationMs !== undefined && this.metricsValue.buildDurationMs > budget.maxBuildDurationMs) violations.push('buildDurationMs');
    if (budget.maxEstimatedBytes !== undefined && this.metricsValue.estimatedBytes > budget.maxEstimatedBytes) violations.push('estimatedBytes');
    return { withinBudget: violations.length === 0, violations };
  }

  queryViewport(viewport: GraphViewport, options: ViewportOptions = {}): VirtualizedGraph {
    const semanticLevel = options.semanticLevel ?? 'labels';
    const padding = Math.max(0, options.padding ?? 0);
    const maxNodes = Math.max(0, options.maxNodes ?? Number.POSITIVE_INFINITY);
    const minCellX = Math.floor((viewport.x - padding) / CELL_SIZE);
    const maxCellX = Math.floor((viewport.x + viewport.width + padding) / CELL_SIZE);
    const minCellY = Math.floor((viewport.y - padding) / CELL_SIZE);
    const maxCellY = Math.floor((viewport.y + viewport.height + padding) / CELL_SIZE);
    const candidates = new Set<string>();
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (const id of this.spatialCells.get(cellKey(cellX, cellY)) ?? []) candidates.add(id);
      }
    }
    const visibleIds = [...candidates]
      .filter((id) => intersects(this.nodesById.get(id)!, viewport, padding))
      .sort(compareText);
    const selectedIds = visibleIds.slice(0, maxNodes);
    const selected = new Set(selectedIds);
    const nodes = selectedIds.map((id): VirtualNode => ({
      ...this.nodesById.get(id)!,
      showLabel: semanticLevel !== 'overview',
      showDetails: semanticLevel === 'detail'
    }));
    const edges = [...this.edgesById.values()]
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge): VirtualEdge => ({ ...edge, showLabel: semanticLevel === 'detail' }));
    return {
      nodes,
      edges,
      totalNodeCount: this.nodesById.size,
      totalEdgeCount: this.edgesById.size,
      truncated: selectedIds.length < visibleIds.length
    };
  }

  findPath(source: string, target: string, options: TraversalOptions = {}): readonly string[] | undefined {
    if (!this.nodesById.has(source) || !this.nodesById.has(target)) return undefined;
    if (source === target) return [source];
    const parents = new Map<string, string>();
    const visited = new Set([source]);
    const queue: Array<{ id: string; depth: number }> = [{ id: source, depth: 0 }];
    const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current.depth >= maxDepth) continue;
      for (const neighbor of this.neighbors(current.id, options.direction ?? 'outgoing')) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        parents.set(neighbor, current.id);
        if (neighbor === target) {
          const path = [target];
          while (path[0] !== source) path.unshift(parents.get(path[0])!);
          return path;
        }
        queue.push({ id: neighbor, depth: current.depth + 1 });
      }
    }
    return undefined;
  }

  isolateNeighborhood(seedIds: readonly string[], options: TraversalOptions = {}): readonly LayoutNode[] {
    return this.traverse(seedIds, { ...options, direction: options.direction ?? 'both' })
      .map((entry) => this.nodesById.get(entry.id)!);
  }

  analyzeImpact(seedIds: readonly string[], options: TraversalOptions = {}): readonly ImpactEntry[] {
    const seeds = new Set(seedIds);
    return this.traverse(seedIds, { ...options, direction: options.direction ?? 'outgoing' })
      .filter((entry) => !seeds.has(entry.id));
  }

  assignEdgeLabelLanes(characterWidth = 7, laneHeight = 16): readonly EdgeLabelLane[] {
    const labels = [...this.edgesById.values()]
      .filter((edge) => edge.label !== undefined && edge.label.length > 0)
      .map((edge) => {
        const source = this.nodesById.get(edge.source)!.position;
        const target = this.nodesById.get(edge.target)!.position;
        const x = (source.x + target.x) / 2;
        const y = (source.y + target.y) / 2;
        const halfWidth = Math.max(characterWidth, edge.label!.length * characterWidth) / 2;
        return { edgeId: edge.id, x, y, start: x - halfWidth, end: x + halfWidth };
      })
      .sort((left, right) => left.y - right.y || left.start - right.start || compareText(left.edgeId, right.edgeId));
    const bands = new Map<number, number[]>();
    return labels.map((label) => {
      const band = Math.round(label.y / laneHeight);
      const laneEnds = bands.get(band) ?? [];
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= label.start) lane += 1;
      laneEnds[lane] = label.end;
      bands.set(band, laneEnds);
      return { edgeId: label.edgeId, lane, x: label.x, y: label.y + lane * laneHeight };
    }).sort((left, right) => compareText(left.edgeId, right.edgeId));
  }

  private neighbors(id: string, direction: 'outgoing' | 'incoming' | 'both'): readonly string[] {
    if (direction === 'outgoing') return this.outgoing.get(id) ?? [];
    if (direction === 'incoming') return this.incoming.get(id) ?? [];
    return [...new Set([...(this.outgoing.get(id) ?? []), ...(this.incoming.get(id) ?? [])])].sort(compareText);
  }

  private traverse(seedIds: readonly string[], options: TraversalOptions): ImpactEntry[] {
    const direction = options.direction ?? 'outgoing';
    const maxDepth = Math.max(0, options.maxDepth ?? Number.POSITIVE_INFINITY);
    const queue = [...new Set(seedIds.filter((id) => this.nodesById.has(id)))]
      .sort(compareText)
      .map((id) => ({ id, distance: 0 }));
    const visited = new Set(queue.map((entry) => entry.id));
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current.distance >= maxDepth) continue;
      for (const neighbor of this.neighbors(current.id, direction)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push({ id: neighbor, distance: current.distance + 1 });
      }
    }
    return queue.sort((left, right) => left.distance - right.distance || compareText(left.id, right.id));
  }
}