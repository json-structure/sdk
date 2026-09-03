import type { GraphRelationDirection, GraphRelationMetadata, GraphTargetIdentity } from '../graph.js';

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
  readonly kind?: 'root' | 'inheritance' | 'reference' | 'relation' | 'relation-qualifier' | 'import';
  readonly status?: 'resolved' | 'unresolved' | 'indeterminate' | 'external';
  readonly pointer?: string;
  readonly targetPointer?: string;
  readonly targetValue?: string;
  readonly documentUri?: string;
  readonly provenance?: 'local' | 'import' | 'importdefs';
  readonly reason?: string;
  readonly cardinality?: 'single' | 'multiple';
  readonly scope?: string | readonly string[];
  readonly semanticBinding?: string;
  readonly relation?: GraphRelationMetadata;
  readonly targetIdentity?: GraphTargetIdentity;
  readonly qualifierIdentity?: GraphTargetIdentity;
  readonly relationPointer?: string;
  readonly relationName?: string;
  readonly declaringSource?: string;
  readonly normalizedScopes?: readonly string[];
  readonly scopeForm?: 'scalar' | 'array';
  readonly qualifierReference?: string;
  readonly targetIdentityProperties?: readonly string[];
  readonly qualifierIdentityProperties?: readonly string[];
  readonly memberEdgeIds?: readonly string[];
  readonly memberPointers?: readonly string[];
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
  readonly direction?: GraphRelationDirection;
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

export interface EdgeLabelLaneOptions {
  readonly operationBudget?: number;
}

export interface EdgeLabelLaneMetrics {
  readonly labelCount: number;
  readonly operationCount: number;
  readonly operationBudget?: number;
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

interface LabelInterval {
  readonly edgeId: string;
  readonly start: number;
  readonly end: number;
  readonly y: number;
}

interface LabelIntervalNode {
  readonly entry: LabelInterval;
  left: LabelIntervalNode | undefined;
  right: LabelIntervalNode | undefined;
  height: number;
  maxEnd: number;
  minY: number;
  maxY: number;
}

class LaneOperationCounter {
  public count = 0;

  public constructor(public readonly budget: number | undefined) {}

  public step(): void {
    this.count += 1;
    if (this.budget !== undefined && this.count > this.budget) {
      throw new Error(`Edge label lane operation budget exceeded: ${this.budget}`);
    }
  }
}

function intervalHeight(node: LabelIntervalNode | undefined): number {
  return node?.height ?? 0;
}

function intervalMaxEnd(node: LabelIntervalNode | undefined): number {
  return node?.maxEnd ?? Number.NEGATIVE_INFINITY;
}

function intervalMinY(node: LabelIntervalNode | undefined): number {
  return node?.minY ?? Number.POSITIVE_INFINITY;
}

function intervalMaxY(node: LabelIntervalNode | undefined): number {
  return node?.maxY ?? Number.NEGATIVE_INFINITY;
}

function compareIntervals(left: LabelInterval, right: LabelInterval): number {
  return left.start - right.start || left.end - right.end || compareText(left.edgeId, right.edgeId);
}

function refreshIntervalNode(node: LabelIntervalNode): void {
  node.height = 1 + Math.max(intervalHeight(node.left), intervalHeight(node.right));
  node.maxEnd = Math.max(node.entry.end, intervalMaxEnd(node.left), intervalMaxEnd(node.right));
  node.minY = Math.min(node.entry.y, intervalMinY(node.left), intervalMinY(node.right));
  node.maxY = Math.max(node.entry.y, intervalMaxY(node.left), intervalMaxY(node.right));
}

function rotateIntervalLeft(node: LabelIntervalNode): LabelIntervalNode {
  const pivot = node.right!;
  node.right = pivot.left;
  pivot.left = node;
  refreshIntervalNode(node);
  refreshIntervalNode(pivot);
  return pivot;
}

function rotateIntervalRight(node: LabelIntervalNode): LabelIntervalNode {
  const pivot = node.left!;
  node.left = pivot.right;
  pivot.right = node;
  refreshIntervalNode(node);
  refreshIntervalNode(pivot);
  return pivot;
}

function balanceIntervalNode(node: LabelIntervalNode): LabelIntervalNode {
  refreshIntervalNode(node);
  const balance = intervalHeight(node.left) - intervalHeight(node.right);
  if (balance > 1) {
    if (intervalHeight(node.left?.left) < intervalHeight(node.left?.right)) node.left = rotateIntervalLeft(node.left!);
    return rotateIntervalRight(node);
  }
  if (balance < -1) {
    if (intervalHeight(node.right?.right) < intervalHeight(node.right?.left)) node.right = rotateIntervalRight(node.right!);
    return rotateIntervalLeft(node);
  }
  return node;
}

function insertIntervalNode(node: LabelIntervalNode | undefined, entry: LabelInterval, operations: LaneOperationCounter): LabelIntervalNode {
  operations.step();
  if (!node) return { entry, left: undefined, right: undefined, height: 1, maxEnd: entry.end, minY: entry.y, maxY: entry.y };
  if (compareIntervals(entry, node.entry) < 0) node.left = insertIntervalNode(node.left, entry, operations);
  else node.right = insertIntervalNode(node.right, entry, operations);
  return balanceIntervalNode(node);
}

function hasIntervalConflict(
  node: LabelIntervalNode | undefined,
  start: number,
  end: number,
  y: number,
  laneHeight: number,
  operations: LaneOperationCounter,
): boolean {
  if (!node) return false;
  operations.step();
  if (node.maxEnd <= start || node.maxY <= y - laneHeight || node.minY >= y + laneHeight) return false;
  if (hasIntervalConflict(node.left, start, end, y, laneHeight, operations)) return true;
  if (node.entry.start < end && start < node.entry.end && Math.abs(node.entry.y - y) < laneHeight) return true;
  if (node.entry.start >= end) return false;
  return hasIntervalConflict(node.right, start, end, y, laneHeight, operations);
}

class LabelIntervalIndex {
  private root: LabelIntervalNode | undefined;

  public insert(entry: LabelInterval, operations: LaneOperationCounter): void {
    this.root = insertIntervalNode(this.root, entry, operations);
  }

  public hasConflict(start: number, end: number, y: number, laneHeight: number, operations: LaneOperationCounter): boolean {
    return hasIntervalConflict(this.root, start, end, y, laneHeight, operations);
  }
}

class LaneEndIndex {
  private size = 1;
  private tree = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  private count = 0;

  public findFirstAvailable(start: number, operations: LaneOperationCounter): number {
    if (this.tree[1]! > start) return this.count;
    return this.findFirstAvailableInTree(1, 0, this.size, start, operations);
  }

  public reserve(lane: number, end: number, operations: LaneOperationCounter): void {
    this.ensureCapacity(lane, operations);
    this.count = Math.max(this.count, lane + 1);
    let index = this.size + lane;
    this.tree[index] = end;
    while (index > 1) {
      index = Math.floor(index / 2);
      operations.step();
      this.tree[index] = Math.min(this.tree[index * 2]!, this.tree[index * 2 + 1]!);
    }
  }

  private findFirstAvailableInTree(index: number, start: number, end: number, threshold: number, operations: LaneOperationCounter): number {
    operations.step();
    if (end - start === 1) return start;
    const middle = Math.floor((start + end) / 2);
    const left = index * 2;
    if (this.tree[left]! <= threshold) return this.findFirstAvailableInTree(left, start, middle, threshold, operations);
    return this.findFirstAvailableInTree(left + 1, middle, end, threshold, operations);
  }

  private ensureCapacity(lane: number, operations: LaneOperationCounter): void {
    if (lane < this.size) return;
    operations.step();
    const oldSize = this.size;
    const oldTree = this.tree;
    while (lane >= this.size) this.size *= 2;
    this.tree = new Array<number>(this.size * 2).fill(Number.NEGATIVE_INFINITY);
    for (let index = 0; index < oldSize; index += 1) this.tree[this.size + index] = oldTree[oldSize + index]!;
    for (let index = this.size - 1; index > 0; index -= 1) this.tree[index] = Math.min(this.tree[index * 2]!, this.tree[index * 2 + 1]!);
  }
}
function cloneNode(node: LayoutNode): LayoutNode {
  return { ...node, position: { ...node.position } };
}

function cloneEdge(edge: GraphEdgeInput): GraphEdgeInput {
  return {
    ...edge,
    ...(edge.scope ? { scope: Array.isArray(edge.scope) ? [...edge.scope] : edge.scope } : {}),
    ...(edge.normalizedScopes ? { normalizedScopes: [...edge.normalizedScopes] } : {}),
    ...(edge.targetIdentityProperties ? { targetIdentityProperties: [...edge.targetIdentityProperties] } : {}),
    ...(edge.qualifierIdentityProperties ? { qualifierIdentityProperties: [...edge.qualifierIdentityProperties] } : {}),
    ...(edge.memberEdgeIds ? { memberEdgeIds: [...edge.memberEdgeIds] } : {}),
    ...(edge.memberPointers ? { memberPointers: [...edge.memberPointers] } : {}),
  };
}

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
  private labelLaneMetricsValue: EdgeLabelLaneMetrics = { labelCount: 0, operationCount: 0 };
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
      const widths = group.map((node) => finiteSize(node.width, NODE_WIDTH));
      const heights = group.map((node) => finiteSize(node.height, NODE_HEIGHT));
      const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...widths.filter((_, index) => index % columns === column), NODE_WIDTH));
      const rowHeights = Array.from({ length: Math.ceil(group.length / columns) }, (_, row) => Math.max(...heights.slice(row * columns, (row + 1) * columns), NODE_HEIGHT));
      const namespaceWidth = columnWidths.reduce((sum, width) => sum + width, 0) + columns * COLUMN_GAP;
      for (let nodeIndex = 0; nodeIndex < group.length; nodeIndex += 1) {
        const node = group[nodeIndex];
        const prior = previous?.nodesById.get(node.id);
        const width = widths[nodeIndex]!;
        const height = heights[nodeIndex]!;
        const column = nodeIndex % columns;
        const row = Math.floor(nodeIndex / columns);
        const generated = {
          x: NAMESPACE_GAP + namespaceIndex * (namespaceWidth + NAMESPACE_GAP)
            + columnWidths.slice(0, column).reduce((sum, columnWidth) => sum + columnWidth + COLUMN_GAP, 0),
          y: rowHeights.slice(0, row).reduce((sum, rowHeight) => sum + rowHeight + ROW_GAP, 0)
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
    return [...this.nodesById.values()].sort((left, right) => compareText(left.id, right.id)).map(cloneNode);
  }

  edges(): readonly GraphEdgeInput[] {
    return [...this.edgesById.values()].map(cloneEdge);
  }

  node(id: string): LayoutNode | undefined {
    const node = this.nodesById.get(id);
    return node ? cloneNode(node) : undefined;
  }

  edge(id: string): GraphEdgeInput | undefined {
    const edge = this.edgesById.get(id);
    return edge ? cloneEdge(edge) : undefined;
  }

  edgesBetween(source: string, target: string): readonly GraphEdgeInput[] {
    return [...this.edgesById.values()].filter((edge) => edge.source === source && edge.target === target).map(cloneEdge);
  }

  neighbors(id: string, direction: GraphRelationDirection = 'outgoing'): readonly string[] {
    if (direction === 'outgoing') return [...new Set(this.outgoing.get(id) ?? [])].sort(compareText);
    if (direction === 'incoming') return [...new Set(this.incoming.get(id) ?? [])].sort(compareText);
    return [...new Set([...(this.outgoing.get(id) ?? []), ...(this.incoming.get(id) ?? [])])].sort(compareText);
  }

  metrics(): GraphPerformanceMetrics {
    return this.metricsValue;
  }

  labelLaneMetrics(): EdgeLabelLaneMetrics {
    return { ...this.labelLaneMetricsValue };
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

  public assignEdgeLabelLanes(
    characterWidth = 7,
    laneHeight = 16,
    options: EdgeLabelLaneOptions = {},
  ): readonly EdgeLabelLane[] {
    if (!Number.isFinite(characterWidth) || characterWidth <= 0) throw new Error('Edge label character width must be finite and positive');
    if (!Number.isFinite(laneHeight) || laneHeight <= 0) throw new Error('Edge label lane height must be finite and positive');
    if (options.operationBudget !== undefined && (!Number.isFinite(options.operationBudget) || options.operationBudget < 0)) {
      throw new Error('Edge label lane operation budget must be finite and non-negative');
    }

    const operations = new LaneOperationCounter(options.operationBudget);
    const labels = [...this.edgesById.values()]
      .filter((edge) => edge.label !== undefined && edge.label.length > 0)
      .map((edge) => {
        const source = this.nodesById.get(edge.source)!.position;
        const target = this.nodesById.get(edge.target)!.position;
        const x = (source.x + target.x) / 2;
        const y = (source.y + target.y) / 2;
        const halfWidth = Math.max(characterWidth, edge.label!.length * characterWidth) / 2;
        return { edgeId: edge.id, x, y, start: x - halfWidth, end: x + halfWidth, band: Math.floor(y / laneHeight) };
      })
      .sort((left, right) => left.band - right.band || left.start - right.start || left.y - right.y || compareText(left.edgeId, right.edgeId));
    this.labelLaneMetricsValue = {
      labelCount: labels.length,
      operationCount: 0,
      ...(options.operationBudget === undefined ? {} : { operationBudget: options.operationBudget }),
    };

    const laneIndexes = new Map<number, LaneEndIndex>();
    const spatialBandSize = laneHeight / 2;
    const spatialBands = new Map<number, LabelIntervalIndex>();
    const output: EdgeLabelLane[] = [];
    for (const label of labels) {
      operations.step();
      const laneIndex = laneIndexes.get(label.band) ?? new LaneEndIndex();
      laneIndexes.set(label.band, laneIndex);
      let lane = laneIndex.findFirstAvailable(label.start, operations);
      let y = label.y + lane * laneHeight;
      while (true) {
        operations.step();
        const firstBand = Math.floor((y - laneHeight) / spatialBandSize);
        const lastBand = Math.floor((y + laneHeight) / spatialBandSize);
        let conflict = false;
        for (let band = firstBand; band <= lastBand; band += 1) {
          operations.step();
          if (spatialBands.get(band)?.hasConflict(label.start, label.end, y, laneHeight, operations) === true) {
            conflict = true;
            break;
          }
        }
        if (!conflict) break;
        lane += 1;
        y = label.y + lane * laneHeight;
      }
      laneIndex.reserve(lane, label.end, operations);
      const placed: LabelInterval = { edgeId: label.edgeId, start: label.start, end: label.end, y };
      const band = Math.floor(y / spatialBandSize);
      const spatialIndex = spatialBands.get(band) ?? new LabelIntervalIndex();
      spatialIndex.insert(placed, operations);
      spatialBands.set(band, spatialIndex);
      output.push({ edgeId: label.edgeId, lane, x: label.x, y });
    }
    this.labelLaneMetricsValue = {
      ...this.labelLaneMetricsValue,
      operationCount: operations.count,
    };
    return output.sort((left, right) => compareText(left.edgeId, right.edgeId));
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
