import type { GraphRelationDirection, ProjectionId } from '../graph.js';
import type { NodeId } from '../contracts.js';
import type { SelectionIdentity } from '../selection.js';
import { type GraphEdge, type GraphNode, type GraphProjection } from './helpers.js';

export type GraphSemanticLevel = 'atlas' | 'types' | 'neighborhood';

export interface SemanticGraphLocation {
  readonly level: GraphSemanticLevel;
  readonly lens: ProjectionId;
  readonly namespace?: string;
  readonly focusNodeId?: string;
  /** Direction used for a relation neighborhood; omitted means outgoing for compatibility. */
  readonly direction?: GraphRelationDirection;
  readonly hops?: 1 | 2;
  readonly isolate?: boolean;
}

export interface SemanticGraphBreadcrumb {
  readonly label: string;
  readonly level: GraphSemanticLevel;
  readonly nodeId?: string;
}

export interface SemanticGraphView {
  readonly location: SemanticGraphLocation;
  readonly relationDirection: GraphRelationDirection;
  readonly direction: GraphRelationDirection;
  readonly projection: GraphProjection;
  readonly selection?: SelectionIdentity;
  readonly breadcrumbs: readonly SemanticGraphBreadcrumb[];
  readonly title: string;
  readonly description: string;
  readonly searchQuery: string;
  readonly searchMatches: readonly string[];
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly canDrillOut: boolean;
  readonly recentPath: readonly { readonly index: number; readonly label: string; readonly current: boolean }[];
  readonly selectedNode?: GraphNode;
  readonly selectedEdge?: GraphEdge;
  /** All authored edges represented by a selected visual bundle. */
  readonly selectedEdges?: readonly GraphEdge[];
  readonly relationMatrix: readonly GraphEdge[];
  readonly relationMatrixSort: GraphRelationMatrixSort;
  readonly relationMatrixAscending: boolean;
  readonly relationMatrixOffset: number;
}

export type GraphRelationMatrixSort = 'source' | 'relation' | 'target' | 'identity' | 'cardinality' | 'scope' | 'qualifier' | 'diagnostic';

export type SemanticGraphEventOrigin = 'graph' | 'design' | 'system';
export interface SemanticGraphEvent {
  readonly type: 'selection-changed' | 'location-changed' | 'source-changed';
  readonly origin: SemanticGraphEventOrigin;
  readonly view: SemanticGraphView;
}
export type SemanticGraphEventListener = (event: SemanticGraphEvent) => void;

interface SemanticHistoryEntry {
  readonly location: SemanticGraphLocation;
  readonly selection?: SelectionIdentity;
}

const lensLabels: Readonly<Record<ProjectionId, string>> = {
  namespaces: 'Namespaces',
  relations: 'Relations',
  extends: 'Extends',
  imports: 'Imports',
};

/** Semantic graph navigation layered over the normalized graph projection. */
export class SemanticGraphController {
  private source: GraphProjection = { nodes: [], edges: [] };
  private location: SemanticGraphLocation = { level: 'atlas', lens: 'relations' };
  private selection: SelectionIdentity | undefined;
  private history: SemanticHistoryEntry[] = [];
  private historyIndex = -1;
  private searchQuery = '';
  private matrixSort: GraphRelationMatrixSort = 'source';
  private matrixAscending = true;
  private matrixOffset = 0;
  private readonly listeners = new Set<SemanticGraphEventListener>();

  /** Subscribes a central UI owner to typed Graph ↔ Design state changes. */
  public on(listener: SemanticGraphEventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public onChange(listener: SemanticGraphEventListener): () => void {
    return this.on(listener);
  }

  public setSource(source: GraphProjection): SemanticGraphView {
    this.source = source;
    if (!this.selection) this.selection = defaultSelection(source, this.location.lens);
    if (this.historyIndex < 0) {
      this.history = [{ location: this.location, selection: this.selection }];
      this.historyIndex = 0;
    }
    const nodeIds = new Set(source.nodes.map((node) => node.id));
    const edgeIds = new Set(source.edges.map((edge) => edge.id));
    if (this.location.focusNodeId && !nodeIds.has(this.location.focusNodeId)) {
      this.location = locationWithDirection({ level: this.location.namespace ? 'types' : 'atlas', lens: this.location.lens, namespace: this.location.namespace }, relationDirectionFor(this.location));
    }
    const projected = projectionForLocation(source, this.location);
    const projectedNodeIds = new Set(projected.nodes.map((node) => node.id));
    const projectedEdgeIds = new Set(projected.edges.map((edge) => edge.id));
    if (this.selection && !selectionRepresented(this.selection, source, nodeIds, edgeIds, projectedNodeIds, projectedEdgeIds)) this.selection = undefined;
    const view = this.view();
    this.publish('source-changed', 'system', view);
    return view;
  }

  public setLens(lens: ProjectionId): SemanticGraphView {
    if (this.location.lens === lens) return this.view();
    this.location = { level: 'atlas', lens };
    this.selection = defaultSelection(this.source, lens);
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  /** Applies a design-owned selection without changing the graph location. */
  public setSelection(selection: SelectionIdentity | undefined, origin: 'design' | 'graph' = 'design'): SemanticGraphView {
    this.selection = selection;
    const view = this.view();
    this.publish('selection-changed', origin, view);
    return view;
  }

  /** Changes the relation neighborhood direction without losing the selected node or edge. */
  public setRelationDirection(direction: GraphRelationDirection): SemanticGraphView {
    const nextLocation = locationWithDirection(this.location, direction);
    if (sameLocation(this.location, nextLocation)) return this.view();
    this.navigate(nextLocation, this.selection);
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  /** Alias used by graph toolbar integrations. */
  public setDirection(direction: GraphRelationDirection): SemanticGraphView {
    return this.setRelationDirection(direction);
  }

  public setNeighborhoodDirection(direction: GraphRelationDirection): SemanticGraphView {
    return this.setRelationDirection(direction);
  }

  public setNeighborhoodHops(hops: 1 | 2): SemanticGraphView {
    if (this.location.level !== 'neighborhood' || (this.location.hops ?? 1) === hops) return this.view();
    this.navigate({ ...this.location, hops: hops === 1 ? undefined : hops }, this.selection);
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public setNeighborhoodIsolation(isolate: boolean): SemanticGraphView {
    if (this.location.level !== 'neighborhood' || Boolean(this.location.isolate) === isolate) return this.view();
    this.navigate({ ...this.location, isolate: isolate || undefined }, this.selection);
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public setSearch(query: string): SemanticGraphView {
    this.searchQuery = query;
    return this.view();
  }

  public sortRelationMatrix(column: GraphRelationMatrixSort): SemanticGraphView {
    if (this.matrixSort === column) this.matrixAscending = !this.matrixAscending;
    else {
      this.matrixSort = column;
      this.matrixAscending = true;
    }
    this.matrixOffset = 0;
    return this.view();
  }

  public moveRelationMatrixWindow(offset: number): SemanticGraphView {
    const maximum = Math.max(0, this.view().relationMatrix.length - 1);
    this.matrixOffset = Math.max(0, Math.min(maximum, offset));
    return this.view();
  }

  public selectNode(nodeId: string): SemanticGraphView {
    const node = this.view().projection.nodes.find((candidate) => candidate.id === nodeId) ?? this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return this.view();
    this.selection = selectionForNode(node);
    const view = this.view();
    this.publish('selection-changed', 'graph', view);
    return view;
  }

  public revealNode(nodeId: string): SemanticGraphView {
    const node = this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return this.view();
    const namespace = normalizedNamespace(node);
    if (this.location.level === 'atlas' || this.location.namespace !== namespace) {
      this.navigate(locationWithDirection({ level: 'types', lens: this.location.lens, namespace }, relationDirectionFor(this.location)), selectionForNode(node));
    } else {
      this.selection = selectionForNode(node);
    }
    const view = this.view();
    this.publish('selection-changed', 'graph', view);
    return view;
  }

  public selectEdge(edgeId: string): SemanticGraphView {
    const edge = this.view().projection.edges.find((candidate) => candidate.id === edgeId) ?? this.source.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return this.view();
    this.selection = selectionForEdge(edge);
    const matrixIndex = relationMatrixFor(this.source, this.matrixSort, this.matrixAscending).findIndex((candidate) => candidate.id === edge.id || edge.memberEdgeIds?.includes(candidate.id));
    if (matrixIndex >= 0) this.matrixOffset = Math.floor(matrixIndex / 200) * 200;
    const view = this.view();
    this.publish('selection-changed', 'graph', view);
    return view;
  }

  public openNode(nodeId: string): SemanticGraphView {
    const currentView = this.view();
    const node = currentView.projection.nodes.find((candidate) => candidate.id === nodeId) ?? this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return currentView;
    if (node.kind === 'document') {
      // An inline root is the document's authored schema, not a namespace named
      // Document. Keep its identity while opening the definitions topology.
      if (this.location.level === 'atlas') {
        this.navigate(locationWithDirection({ level: 'types', lens: this.location.lens, namespace: 'Definitions' }, relationDirectionFor(this.location)), selectionForNode(node));
      } else {
        this.selection = selectionForNode(node);
      }
    } else if (this.location.lens === 'extends' || this.location.lens === 'imports') {
      this.selection = selectionForNode(node);
    } else if (this.location.level === 'atlas') {
      const namespace = namespaceFromAtlasNode(node);
      const initialType = this.location.lens === 'relations'
        ? this.source.nodes.find((candidate) => candidate.kind === 'type' && normalizedNamespace(candidate) === namespace && candidate.label === 'Place')
          ?? this.source.nodes.find((candidate) => candidate.kind === 'type' && normalizedNamespace(candidate) === namespace)
        : undefined;
      this.navigate(locationWithDirection({ level: 'types', lens: this.location.lens, namespace }, relationDirectionFor(this.location)), selectionForNode(initialType ?? node));
    } else if (this.location.lens === 'relations' && this.location.level === 'types') {
      this.navigate(locationWithDirection({ level: 'neighborhood', lens: this.location.lens, namespace: this.location.namespace ?? normalizedNamespace(node), focusNodeId: sourceNodeId(node) }, relationDirectionFor(this.location)), selectionForNode(node));
    } else {
      this.selection = selectionForNode(node);
    }
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public openSelection(): SemanticGraphView {
    const nodeId = this.selection?.kind === 'type' || this.selection?.kind === 'namespace'
      ? this.selection.nodeId
      : this.location.focusNodeId;
    return nodeId ? this.openNode(nodeId) : this.view();
  }

  public drillOut(): SemanticGraphView {
    if (this.location.level === 'neighborhood') {
      const focus = this.location.focusNodeId ? this.source.nodes.find((node) => node.id === this.location.focusNodeId) : undefined;
      this.navigate({ level: 'types', lens: this.location.lens, namespace: this.location.namespace }, focus ? selectionForNode(focus) : undefined);
    } else if (this.location.level === 'types') {
      const atlasNode = this.location.namespace ? atlasNodeFor(this.location.namespace) : undefined;
      this.navigate({ level: 'atlas', lens: this.location.lens }, atlasNode ? selectionForNode(atlasNode) : defaultSelection(this.source, this.location.lens));
    }
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public home(): SemanticGraphView {
    if (this.location.level !== 'atlas') this.navigate({ level: 'atlas', lens: this.location.lens }, defaultSelection(this.source, this.location.lens));
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public back(): SemanticGraphView {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      const entry = this.history[this.historyIndex]!;
      this.location = { ...entry.location };
      this.selection = entry.selection;
    }
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public forward(): SemanticGraphView {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      const entry = this.history[this.historyIndex]!;
      this.location = { ...entry.location };
      this.selection = entry.selection;
    }
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  public view(): SemanticGraphView {
    const baseProjection = projectionForLocation(this.source, this.location);
    const projection = projectionWithSelectedEdge(baseProjection, this.source, this.selection);
    const query = this.searchQuery.trim().toLocaleLowerCase();
    const searchMatches = query
      ? projection.nodes.filter((node) => {
        const connectedLabels = projection.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => edge.label).join(' ');
        return `${node.label} ${node.namespace} ${node.target ?? ''} ${connectedLabels}`.toLocaleLowerCase().includes(query);
      }).map((node) => node.id)
      : [];
    const focus = this.location.focusNodeId ? this.source.nodes.find((node) => node.id === this.location.focusNodeId) : undefined;
    const lensLabel = lensLabels[this.location.lens];
    const title = this.location.level === 'atlas' ? 'Schema atlas' : this.location.level === 'types' ? this.location.namespace ?? 'Type topology' : focus?.label ?? 'Neighborhood';
    const description = this.location.level === 'atlas'
      ? `${namespaceNames(this.source).length} namespaces · ${projection.nodes.length} domains · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`
      : this.location.level === 'types'
        ? `${projection.nodes.length} visible types · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`
        : `${this.location.hops ?? 1}-hop ${this.location.isolate ? 'isolated' : 'global-context'} view · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`;
    return {
      location: this.location,
      projection,
      selection: this.selection,
      breadcrumbs: breadcrumbsFor(this.location, focus),
      title,
      description,
      searchQuery: this.searchQuery,
      searchMatches,
      canBack: this.historyIndex > 0,
      canForward: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1,
      canDrillOut: this.location.level !== 'atlas',
      recentPath: this.history.map((entry, index) => ({ index, label: historyLabel(entry.location, this.source), current: index === this.historyIndex })).slice(-6).reverse(),
      relationDirection: relationDirectionFor(this.location),
      direction: relationDirectionFor(this.location),
      selectedNode: this.selection?.nodeId ? projection.nodes.find((node) => node.id === this.selection?.nodeId) ?? this.source.nodes.find((node) => node.id === this.selection?.nodeId) : undefined,
      selectedEdge: this.selection?.nodeId ? projection.edges.find((edge) => edge.id === this.selection?.nodeId) ?? this.source.edges.find((edge) => edge.id === this.selection?.nodeId) : undefined,
      selectedEdges: selectedEdgesFor(this.selection, this.source, projection),
      relationMatrix: relationMatrixFor(this.source, this.matrixSort, this.matrixAscending),
      relationMatrixSort: this.matrixSort,
      relationMatrixAscending: this.matrixAscending,
      relationMatrixOffset: this.matrixOffset,
    };
  }


  public restore(index: number): SemanticGraphView {
    if (index < 0 || index >= this.history.length) return this.view();
    this.historyIndex = index;
    const entry = this.history[index]!;
    this.location = { ...entry.location };
    this.selection = entry.selection;
    const view = this.view();
    this.publish('location-changed', 'graph', view);
    return view;
  }

  private publish(type: SemanticGraphEvent['type'], origin: SemanticGraphEventOrigin, view: SemanticGraphView): void {
    const event: SemanticGraphEvent = { type, origin, view };
    for (const listener of [...this.listeners]) listener(event);
  }

  private navigate(location: SemanticGraphLocation, selection: SelectionIdentity | undefined): void {
    if (sameLocation(this.location, location) && sameSelectionIdentity(this.selection, selection)) return;
    const entry = { location, selection };
    this.location = location;
    this.selection = selection;
    this.history = this.historyIndex >= 0 ? this.history.slice(0, this.historyIndex + 1) : [];
    this.history.push(entry);
    this.historyIndex = this.history.length - 1;
  }
}

  function relationMatrixFor(source: GraphProjection, sort: GraphRelationMatrixSort, ascending: boolean): readonly GraphEdge[] {
    const direction = ascending ? 1 : -1;
    return source.edges.filter((edge) => edge.kind === 'relation').sort((left, right) => {
      const comparison = matrixValue(left, sort).localeCompare(matrixValue(right, sort), undefined, { numeric: true, sensitivity: 'base' });
      return comparison * direction || left.id.localeCompare(right.id);
    });
  }

  function matrixValue(edge: GraphEdge, column: GraphRelationMatrixSort): string {
    if (column === 'source') return edge.declaringSource ?? edge.from;
    if (column === 'relation') return edge.relationName ?? edge.label;
    if (column === 'target') return edge.targetIdentity?.reference ?? edge.target ?? edge.to;
    if (column === 'identity') return edge.targetIdentityProperties?.join(', ') ?? '';
    if (column === 'cardinality') return edge.cardinality ?? '';
    if (column === 'scope') return edge.normalizedScopes?.join(', ') ?? '';
    if (column === 'qualifier') return edge.qualifierReference ?? '';
    return `${edge.status ?? 'resolved'} ${edge.reason ?? ''}`;
  }

function selectionRepresented(selection: SelectionIdentity, source: GraphProjection, nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>, projectedNodeIds: ReadonlySet<string>, projectedEdgeIds: ReadonlySet<string>): boolean {
  if (selection.nodeId && (nodeIds.has(selection.nodeId) || edgeIds.has(selection.nodeId) || projectedNodeIds.has(selection.nodeId) || projectedEdgeIds.has(selection.nodeId))) return true;
  if (selection.kind === 'document') return source.nodes.some((node) => node.kind === 'document');
  if (selection.kind === 'namespace') return source.nodes.some((node) => node.kind === 'namespace') || Boolean(selection.nodeId?.startsWith('graph:namespace:'));
  return false;
}

function sameSelectionIdentity(left: SelectionIdentity | undefined, right: SelectionIdentity | undefined): boolean {
  return left?.kind === right?.kind && left?.nodeId === right?.nodeId && left?.pointer === right?.pointer &&
    left?.location?.uri === right?.location?.uri && left?.location?.pointer === right?.location?.pointer;
}

function projectionForLocation(source: GraphProjection, location: SemanticGraphLocation): GraphProjection {
  if (location.lens === 'namespaces' && location.level === 'atlas') return namespaceAtlasProjection(source);
  if (location.level === 'atlas') return atlasProjection(source, location.lens);
  const lensProjection = typeProjection(source, location.lens, location.namespace);
  if (location.level !== 'neighborhood' || !location.focusNodeId) return lensProjection;
  return location.lens === 'relations' ? relationNeighborhood(source, location.focusNodeId, relationDirectionFor(location), location.hops ?? 1, Boolean(location.isolate)) : lensProjection;
}

function atlasProjection(source: GraphProjection, lens: ProjectionId): GraphProjection {
  const namespaces = namespaceNames(source);
  const documentNode = source.nodes.find((node) => node.kind === 'document');
  const nodes: GraphNode[] = [
    ...(documentNode ? [documentNode] : []),
    ...namespaces.map((namespace) => atlasNodeFor(namespace, namespaceMemberCount(source, namespace))),
  ];
  const namespaceSet = new Set(namespaces);
  const namespaceByNode = new Map(source.nodes.map((node) => [node.id, atlasKeyForNode(node, documentNode, namespaceSet)]));
  const aggregate = new Map<string, { from: string; to: string; count: number; statuses: Set<string>; members: GraphEdge[] }>();
  for (const edge of filteredEdges(source.edges, lens)) {
    const fromNamespace = namespaceByNode.get(edge.from);
    const toNamespace = namespaceByNode.get(edge.to);
    if (!fromNamespace || !toNamespace || fromNamespace === toNamespace) continue;
    const key = `${fromNamespace}\u0000${toNamespace}`;
    const existing = aggregate.get(key) ?? { from: fromNamespace, to: toNamespace, count: 0, statuses: new Set<string>(), members: [] };
    existing.count += 1;
    existing.members.push(edge);
    if (edge.status) existing.statuses.add(edge.status);
    aggregate.set(key, existing);
  }
  const aggregateEdges: GraphEdge[] = [...aggregate.values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)).map((entry) => ({
    id: `graph:atlas:${lens}:${encodeURIComponent(entry.from)}:${encodeURIComponent(entry.to)}`,
    from: documentNode && entry.from === documentNode.id ? entry.from : atlasNodeId(entry.from),
    to: documentNode && entry.to === documentNode.id ? entry.to : atlasNodeId(entry.to),
    label: `${entry.count} ${entry.count === 1 ? 'link' : 'links'}`,
    kind: lensEdgeKind(lens),
    status: entry.statuses.has('unresolved') ? 'unresolved' : entry.statuses.has('indeterminate') ? 'indeterminate' : 'resolved',
    selectable: true,
    memberEdgeIds: entry.members.map((edge) => edge.id),
    memberPointers: entry.members.map((edge) => edge.pointer).filter((pointer): pointer is string => pointer !== undefined),
  }));
  const scaffold = documentNode ? namespaces.map((namespace): GraphEdge => ({
    id: `graph:atlas-root:${encodeURIComponent(namespace)}`,
    from: documentNode.id,
    to: atlasNodeId(namespace),
    label: 'contains',
    kind: 'root',
    status: 'resolved',
    selectable: false,
  })) : [];
  return { nodes, edges: [...scaffold, ...aggregateEdges] };
}

function typeProjection(source: GraphProjection, lens: ProjectionId, namespace?: string): GraphProjection {
  if (lens === 'namespaces') return namespaceContainmentProjection(source, namespace);
  const edges = filteredEdges(source.edges, lens);
  const primary = new Set(source.nodes.filter((node) => !namespace || normalizedNamespace(node) === namespace || node.kind === 'document' && namespace === 'Definitions').map((node) => node.id));
  const visibleEdges = edges.filter((edge) => primary.has(edge.from) && primary.has(edge.to));
  return {
    nodes: source.nodes.filter((node) => primary.has(node.id)),
    edges: lens === 'relations' ? bundleParallelRelations(visibleEdges, `graph:type-bundle:${encodeURIComponent(namespace ?? 'all')}`) : visibleEdges,
  };
}

function namespaceAtlasProjection(source: GraphProjection): GraphProjection {
  const namespaces = namespaceNames(source);
  const documentNode = source.nodes.find((node) => node.kind === 'document');
  const namespaceNodes = namespaces.map((namespace) => atlasNodeFor(namespace, namespaceMemberCount(source, namespace)));
  const rootEdges = documentNode
    ? namespaceNodes.map((node) => ({ id: `graph:root:${node.id}`, from: documentNode.id, to: node.id, label: 'contains', kind: 'root' as const, selectable: false }))
    : [];
  return {
    nodes: [...(documentNode ? [documentNode] : []), ...namespaceNodes],
    edges: rootEdges,
  };
}

function relationNeighborhood(source: GraphProjection, focusNodeId: string, direction: GraphRelationDirection, hops: 1 | 2, isolate: boolean): GraphProjection {
  const relationSource = source.edges.filter((edge) => edge.kind === 'relation' || edge.kind === 'relation-qualifier');
  const visible = new Set([focusNodeId]);
  let frontier = new Set([focusNodeId]);
  for (let depth = 0; depth < hops; depth += 1) {
    const next = new Set<string>();
    for (const edge of relationSource) {
      const outgoing = frontier.has(edge.from) && direction !== 'incoming';
      const incoming = frontier.has(edge.to) && direction !== 'outgoing';
      if (outgoing) next.add(edge.to);
      if (incoming) next.add(edge.from);
    }
    for (const id of next) visible.add(id);
    frontier = next;
  }
  const relationEdges = relationSource.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  const nodes = source.nodes.filter((node) => node.kind !== 'namespace' && (!isolate || visible.has(node.id))).map((node) => visible.has(node.id) ? node : { ...node, contextDimmed: true });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const selectedIds = new Set(relationEdges.map((edge) => edge.id));
  const edges = filteredEdges(source.edges, 'relations')
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .filter((edge) => !isolate || selectedIds.has(edge.id))
    .map((edge) => selectedIds.has(edge.id) ? edge : { ...edge, contextDimmed: true });
  return { nodes, edges };
}

function bundleParallelRelations(edges: readonly GraphEdge[], prefix: string): readonly GraphEdge[] {
  const groups = new Map<string, GraphEdge[]>();
  const passthrough: GraphEdge[] = [];
  for (const edge of edges) {
    if (edge.kind !== 'relation') {
      passthrough.push(edge);
      continue;
    }
    const key = `${edge.from}\u0000${edge.to}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const bundled = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, members]) => {
    const ordered = members.slice().sort((left, right) => left.id.localeCompare(right.id));
    if (ordered.length === 1) return ordered[0]!;
    const representative = ordered[0]!;
    return {
      ...representative,
      id: `${prefix}:${encodeURIComponent(key)}`,
      label: `${ordered.length} relations`,
      pointer: undefined,
      targetPointer: undefined,
      memberEdgeIds: ordered.map((edge) => edge.id),
      memberPointers: ordered.map((edge) => edge.pointer).filter((pointer): pointer is string => pointer !== undefined),
      selectable: true,
    };
  });
  return [...passthrough, ...bundled].sort((left, right) => left.id.localeCompare(right.id));
}

function relationDirectionFor(location: SemanticGraphLocation): GraphRelationDirection {
  return location.direction ?? 'outgoing';
}

function locationWithDirection(location: SemanticGraphLocation, direction: GraphRelationDirection): SemanticGraphLocation {
  if (direction !== 'outgoing') return { ...location, direction };
  return { level: location.level, lens: location.lens, ...(location.namespace ? { namespace: location.namespace } : {}), ...(location.focusNodeId ? { focusNodeId: location.focusNodeId } : {}), ...(location.hops ? { hops: location.hops } : {}), ...(location.isolate ? { isolate: location.isolate } : {}) };
}

function projectionWithSelectedEdge(projection: GraphProjection, source: GraphProjection, selection: SelectionIdentity | undefined): GraphProjection {
  if (!selection?.nodeId || selection.kind !== 'relation' && selection.kind !== 'source') return projection;
  const selected = source.edges.find((edge) => edge.id === selection.nodeId);
  if (!selected || selected.kind !== 'relation' && selected.kind !== 'relation-qualifier' || projection.edges.some((edge) => edge.id === selected.id)) return projection;
  if (!projection.nodes.some((node) => node.id === selected.from) || !projection.nodes.some((node) => node.id === selected.to)) return projection;
  const bundle = projection.edges.find((edge) => edge.memberEdgeIds?.includes(selected.id));
  return { nodes: projection.nodes, edges: bundle ? projection.edges.map((edge) => edge.id === bundle.id ? selected : edge) : [...projection.edges, selected] };
}
function namespaceContainmentProjection(source: GraphProjection, namespace?: string): GraphProjection {
  const documentNode = source.nodes.find((node) => node.kind === 'document');
  const types = source.nodes.filter((node) => node.kind !== 'namespace' && node.kind !== 'document' && (!namespace || normalizedNamespace(node) === namespace));
  const names = [...new Set(types.map(normalizedNamespace))].sort();
  const namespaceNodes: GraphNode[] = names.map((name) => atlasNodeFor(name, namespaceMemberCount(source, name)));
  const edges: GraphEdge[] = types.map((node) => ({
    id: `graph:contains:${encodeURIComponent(normalizedNamespace(node))}:${node.id}`,
    from: atlasNodeId(normalizedNamespace(node)),
    to: node.id,
    label: 'contains',
    kind: 'root',
    status: node.status,
    selectable: false,
  }));
  return { nodes: [...(documentNode && namespace === 'Definitions' ? [documentNode] : []), ...namespaceNodes, ...types], edges };
}

function filteredEdges(edges: readonly GraphEdge[], lens: ProjectionId): readonly GraphEdge[] {
  if (lens === 'relations') return edges.filter((edge) => edge.kind === 'relation' || edge.kind === 'relation-qualifier' || edge.kind === 'reference');
  if (lens === 'extends') return edges.filter((edge) => edge.kind === 'inheritance');
  if (lens === 'imports') return edges.filter((edge) => edge.kind === 'import');
  return edges;
}

function selectionForNode(node: GraphNode): SelectionIdentity {
  const kind = node.kind === 'namespace' ? 'namespace' : node.kind === 'document' ? 'document' : 'type';
  return { kind, nodeId: node.id as NodeId, pointer: node.pointer };
}

function selectionForEdge(edge: GraphEdge): SelectionIdentity {
  const kind = edge.kind === 'relation' || edge.kind === 'relation-qualifier' ? 'relation' : 'source';
  const pointer = isBundledEdge(edge) ? undefined : edge.pointer ?? edge.targetPointer;
  return { kind, nodeId: edge.id as NodeId, ...(pointer ? { pointer } : {}) };
}

function isBundledEdge(edge: GraphEdge): edge is GraphEdge & { readonly memberEdgeIds: readonly string[] } {
  return 'memberEdgeIds' in edge && Array.isArray(edge.memberEdgeIds) && edge.memberEdgeIds.every((id): id is string => typeof id === 'string');
}

function selectedEdgesFor(selection: SelectionIdentity | undefined, source: GraphProjection, projection: GraphProjection): readonly GraphEdge[] | undefined {
  if (!selection?.nodeId || selection.kind !== 'relation' && selection.kind !== 'source') return undefined;
  const selected = projection.edges.find((edge) => edge.id === selection.nodeId) ?? source.edges.find((edge) => edge.id === selection.nodeId);
  if (!selected) return undefined;
  if (!isBundledEdge(selected)) return [selected];
  return selected.memberEdgeIds.map((id) => source.edges.find((edge) => edge.id === id)).filter((edge): edge is GraphEdge => edge !== undefined);
}

function breadcrumbsFor(location: SemanticGraphLocation, focus: GraphNode | undefined): readonly SemanticGraphBreadcrumb[] {
  const breadcrumbs: SemanticGraphBreadcrumb[] = [{ label: 'Atlas', level: 'atlas' }];
  if (location.level !== 'atlas') breadcrumbs.push({ label: location.namespace ?? 'Types', level: 'types' });
  if (location.level === 'neighborhood') breadcrumbs.push({ label: focus?.label ?? 'Neighborhood', level: 'neighborhood', nodeId: location.focusNodeId });
  return breadcrumbs;
}

function namespaceNames(source: GraphProjection): readonly string[] {
  return [...new Set(source.nodes.filter((node) => node.kind === 'type' || node.kind === 'target' && node.namespace === 'root').map(normalizedNamespace))].sort();
}

function normalizedNamespace(node: GraphNode): string {
  if (node.kind === 'document') return 'Document';
  return node.namespace && node.namespace !== 'root' && node.namespace.toLocaleLowerCase() !== 'definitions' ? node.namespace : 'Definitions';
}

function atlasNodeId(namespace: string): string {
  return `graph:namespace:${encodeURIComponent(namespace)}`;
}

function atlasNodeFor(namespace: string, memberCount?: number): GraphNode {
  return { id: atlasNodeId(namespace), pointer: '', label: namespace, namespace, kind: 'namespace', status: 'resolved', selectable: true, ...(memberCount !== undefined ? { memberCount } : {}) };
}

function namespaceMemberCount(source: GraphProjection, namespace: string): number {
  return source.nodes.filter((node) => node.kind !== 'namespace' && node.kind !== 'document' && normalizedNamespace(node) === namespace).length;
}

function atlasKeyForNode(node: GraphNode, documentNode: GraphNode | undefined, namespaces: ReadonlySet<string>): string | undefined {
  if (documentNode && node.id === documentNode.id) return node.id;
  const namespace = normalizedNamespace(node);
  return namespaces.has(namespace) ? namespace : undefined;
}

function namespaceFromAtlasNode(node: GraphNode): string {
  return node.id.startsWith('graph:namespace:') ? decodeURIComponent(node.id.slice('graph:namespace:'.length)) : normalizedNamespace(node);
}

function sourceNodeId(node: GraphNode): string {
  return node.id.startsWith('graph:namespace:') ? node.id : node.id;
}

function lensEdgeKind(lens: ProjectionId): GraphEdge['kind'] {
  if (lens === 'extends') return 'inheritance';
  if (lens === 'imports') return 'import';
  if (lens === 'relations') return 'relation';
  return 'root';
}

function defaultSelection(source: GraphProjection, lens: ProjectionId): SelectionIdentity | undefined {
  const projection = lens === 'namespaces' ? namespaceAtlasProjection(source) : atlasProjection(source, lens);
  const preferred = projection.nodes.find((node) => node.kind === 'namespace' && node.label === 'Nodes')
    ?? projection.nodes.find((node) => node.kind === 'namespace')
    ?? projection.nodes[0];
  return preferred ? selectionForNode(preferred) : undefined;
}

function sameLocation(left: SemanticGraphLocation, right: SemanticGraphLocation): boolean {
  return left.level === right.level && left.lens === right.lens && left.namespace === right.namespace && left.focusNodeId === right.focusNodeId && relationDirectionFor(left) === relationDirectionFor(right) && (left.hops ?? 1) === (right.hops ?? 1) && Boolean(left.isolate) === Boolean(right.isolate);
}

function historyLabel(location: SemanticGraphLocation, source: GraphProjection): string {
  if (location.level === 'atlas') return 'Atlas';
  if (location.level === 'types') return location.namespace ?? 'Types';
  return source.nodes.find((node) => node.id === location.focusNodeId)?.label ?? 'Neighborhood';
}
