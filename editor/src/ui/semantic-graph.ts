import type { ProjectionId } from '../graph.js';
import { GraphRuntime } from '../phase4/graph-runtime.js';
import type { JsonPointer, NodeId } from '../contracts.js';
import type { SelectionIdentity } from '../selection.js';
import type { GraphEdge, GraphNode, GraphProjection } from './helpers.js';

export type GraphSemanticLevel = 'atlas' | 'types' | 'neighborhood';

export interface SemanticGraphLocation {
  readonly level: GraphSemanticLevel;
  readonly lens: ProjectionId;
  readonly namespace?: string;
  readonly focusNodeId?: string;
}

export interface SemanticGraphBreadcrumb {
  readonly label: string;
  readonly level: GraphSemanticLevel;
  readonly nodeId?: string;
}

export interface SemanticGraphView {
  readonly location: SemanticGraphLocation;
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
}

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

  public setSource(source: GraphProjection): SemanticGraphView {
    this.source = source;
    if (this.historyIndex < 0) {
      this.history = [{ location: this.location, selection: this.selection }];
      this.historyIndex = 0;
    }
    const nodeIds = new Set(source.nodes.map((node) => node.id));
    const edgeIds = new Set(source.edges.map((edge) => edge.id));
    if (this.location.focusNodeId && !nodeIds.has(this.location.focusNodeId)) {
      this.location = { level: this.location.namespace ? 'types' : 'atlas', lens: this.location.lens, namespace: this.location.namespace };
    }
    if (this.selection?.nodeId && !nodeIds.has(this.selection.nodeId) && !edgeIds.has(this.selection.nodeId) && !this.selection.nodeId.startsWith('graph:namespace:')) this.selection = undefined;
    return this.view();
  }

  public setLens(lens: ProjectionId): SemanticGraphView {
    this.location = { ...this.location, lens };
    return this.view();
  }

  public setSearch(query: string): SemanticGraphView {
    this.searchQuery = query;
    return this.view();
  }

  public selectNode(nodeId: string): SemanticGraphView {
    const node = this.view().projection.nodes.find((candidate) => candidate.id === nodeId) ?? this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return this.view();
    this.selection = selectionForNode(node);
    return this.view();
  }

  public selectEdge(edgeId: string): SemanticGraphView {
    const edge = this.view().projection.edges.find((candidate) => candidate.id === edgeId) ?? this.source.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return this.view();
    this.selection = selectionForEdge(edge);
    return this.view();
  }

  public openNode(nodeId: string): SemanticGraphView {
    const view = this.view();
    const node = view.projection.nodes.find((candidate) => candidate.id === nodeId) ?? this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return view;
    if (this.location.level === 'atlas') {
      const namespace = namespaceFromAtlasNode(node);
      this.navigate({ level: 'types', lens: this.location.lens, namespace }, selectionForNode(node));
    } else {
      this.navigate({ level: 'neighborhood', lens: this.location.lens, namespace: this.location.namespace ?? normalizedNamespace(node), focusNodeId: sourceNodeId(node) }, selectionForNode(node));
    }
    return this.view();
  }

  public openSelection(): SemanticGraphView {
    const nodeId = this.selection?.nodeId;
    return nodeId ? this.openNode(nodeId) : this.view();
  }

  public drillOut(): SemanticGraphView {
    if (this.location.level === 'neighborhood') this.navigate({ level: 'types', lens: this.location.lens, namespace: this.location.namespace }, this.selection);
    else if (this.location.level === 'types') this.navigate({ level: 'atlas', lens: this.location.lens }, this.selection);
    return this.view();
  }

  public home(): SemanticGraphView {
    this.navigate({ level: 'atlas', lens: this.location.lens }, undefined);
    return this.view();
  }

  public back(): SemanticGraphView {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      const entry = this.history[this.historyIndex]!;
      this.location = entry.location;
      this.selection = entry.selection;
    }
    return this.view();
  }

  public forward(): SemanticGraphView {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      const entry = this.history[this.historyIndex]!;
      this.location = entry.location;
      this.selection = entry.selection;
    }
    return this.view();
  }

  public view(): SemanticGraphView {
    const projection = projectionForLocation(this.source, this.location);
    const query = this.searchQuery.trim().toLocaleLowerCase();
    const searchMatches = query
      ? projection.nodes.filter((node) => `${node.label} ${node.namespace} ${node.target ?? ''}`.toLocaleLowerCase().includes(query)).map((node) => node.id)
      : [];
    const focus = this.location.focusNodeId ? this.source.nodes.find((node) => node.id === this.location.focusNodeId) : undefined;
    const lensLabel = lensLabels[this.location.lens];
    const title = this.location.level === 'atlas' ? 'Schema atlas' : this.location.level === 'types' ? this.location.namespace ?? 'Type topology' : focus?.label ?? 'Neighborhood';
    const description = this.location.level === 'atlas'
      ? `${namespaceNames(this.source).length} namespaces · ${projection.nodes.length} domains · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`
      : this.location.level === 'types'
        ? `${projection.nodes.length} visible types · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`
        : `${projection.nodes.length} types in one-hop context · ${projection.edges.length} ${lensLabel.toLocaleLowerCase()} links`;
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
    };
  }

  private navigate(location: SemanticGraphLocation, selection: SelectionIdentity | undefined): void {
    const entry = { location, selection };
    this.location = location;
    this.selection = selection;
    this.history = this.historyIndex >= 0 ? this.history.slice(0, this.historyIndex + 1) : [];
    this.history.push(entry);
    this.historyIndex = this.history.length - 1;
  }
}

function projectionForLocation(source: GraphProjection, location: SemanticGraphLocation): GraphProjection {
  if (location.level === 'atlas') return atlasProjection(source, location.lens);
  const lensProjection = typeProjection(source, location.lens, location.namespace);
  if (location.level !== 'neighborhood' || !location.focusNodeId) return lensProjection;
  const runtime = runtimeFor(lensProjection);
  const visibleIds = new Set(runtime.isolateNeighborhood([location.focusNodeId], { direction: 'both', maxDepth: 1 }).map((node) => node.id));
  if (!visibleIds.size) return lensProjection;
  return {
    nodes: lensProjection.nodes.filter((node) => visibleIds.has(node.id)),
    edges: lensProjection.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
  };
}

function atlasProjection(source: GraphProjection, lens: ProjectionId): GraphProjection {
  const namespaces = namespaceNames(source);
  const nodes: GraphNode[] = namespaces.map((namespace) => ({
    id: atlasNodeId(namespace),
    pointer: '',
    label: namespace,
    namespace,
    kind: 'namespace',
    status: 'resolved',
    selectable: true,
  }));
  const namespaceByNode = new Map(source.nodes.map((node) => [node.id, normalizedNamespace(node)]));
  const aggregate = new Map<string, { from: string; to: string; count: number; statuses: Set<string> }>();
  for (const edge of filteredEdges(source.edges, lens)) {
    const fromNamespace = namespaceByNode.get(edge.from);
    const toNamespace = namespaceByNode.get(edge.to);
    if (!fromNamespace || !toNamespace || fromNamespace === toNamespace) continue;
    const key = `${fromNamespace}\u0000${toNamespace}`;
    const existing = aggregate.get(key) ?? { from: fromNamespace, to: toNamespace, count: 0, statuses: new Set<string>() };
    existing.count += 1;
    if (edge.status) existing.statuses.add(edge.status);
    aggregate.set(key, existing);
  }
  const edges: GraphEdge[] = [...aggregate.values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)).map((entry) => ({
    id: `graph:atlas:${lens}:${encodeURIComponent(entry.from)}:${encodeURIComponent(entry.to)}`,
    from: atlasNodeId(entry.from),
    to: atlasNodeId(entry.to),
    label: `${entry.count} ${entry.count === 1 ? 'link' : 'links'}`,
    kind: lensEdgeKind(lens),
    status: entry.statuses.has('unresolved') ? 'unresolved' : entry.statuses.has('indeterminate') ? 'indeterminate' : 'resolved',
    selectable: false,
  }));
  return { nodes, edges };
}

function typeProjection(source: GraphProjection, lens: ProjectionId, namespace?: string): GraphProjection {
  if (lens === 'namespaces') return namespaceContainmentProjection(source, namespace);
  const edges = filteredEdges(source.edges, lens);
  const primary = new Set(source.nodes.filter((node) => !namespace || normalizedNamespace(node) === namespace).map((node) => node.id));
  const visible = new Set(primary);
  for (const edge of edges) if (primary.has(edge.from) || primary.has(edge.to) || !namespace) {
    visible.add(edge.from);
    visible.add(edge.to);
  }
  return {
    nodes: source.nodes.filter((node) => visible.has(node.id)),
    edges: edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
  };
}

function namespaceContainmentProjection(source: GraphProjection, namespace?: string): GraphProjection {
  const types = source.nodes.filter((node) => node.kind !== 'namespace' && (!namespace || normalizedNamespace(node) === namespace));
  const names = [...new Set(types.map(normalizedNamespace))].sort();
  const namespaceNodes: GraphNode[] = names.map((name) => ({ id: atlasNodeId(name), pointer: '', label: name, namespace: name, kind: 'namespace', status: 'resolved', selectable: true }));
  const edges: GraphEdge[] = types.map((node) => ({
    id: `graph:contains:${encodeURIComponent(normalizedNamespace(node))}:${node.id}`,
    from: atlasNodeId(normalizedNamespace(node)),
    to: node.id,
    label: 'contains',
    kind: 'root',
    status: node.status,
    selectable: false,
  }));
  return { nodes: [...namespaceNodes, ...types], edges };
}

function filteredEdges(edges: readonly GraphEdge[], lens: ProjectionId): readonly GraphEdge[] {
  if (lens === 'relations') return edges.filter((edge) => edge.kind === 'relation' || edge.kind === 'relation-qualifier');
  if (lens === 'extends') return edges.filter((edge) => edge.kind === 'inheritance');
  if (lens === 'imports') return edges.filter((edge) => edge.kind === 'import');
  return edges;
}

function runtimeFor(projection: GraphProjection): GraphRuntime {
  const ids = new Set(projection.nodes.map((node) => node.id));
  return new GraphRuntime({
    nodes: projection.nodes.map((node) => ({ id: node.id, namespace: node.namespace, label: node.label })),
    edges: projection.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label })),
  });
}

function selectionForNode(node: GraphNode): SelectionIdentity {
  const kind = node.kind === 'namespace' ? 'namespace' : node.kind === 'document' ? 'document' : 'type';
  return { kind, nodeId: node.id as NodeId, pointer: node.pointer };
}

function selectionForEdge(edge: GraphEdge): SelectionIdentity {
  const kind = edge.kind === 'relation' || edge.kind === 'relation-qualifier' ? 'relation' : 'source';
  return { kind, nodeId: edge.id as NodeId, pointer: (edge.pointer ?? edge.targetPointer) as JsonPointer | undefined };
}

function breadcrumbsFor(location: SemanticGraphLocation, focus: GraphNode | undefined): readonly SemanticGraphBreadcrumb[] {
  const breadcrumbs: SemanticGraphBreadcrumb[] = [{ label: 'Atlas', level: 'atlas' }];
  if (location.level !== 'atlas') breadcrumbs.push({ label: location.namespace ?? 'Types', level: 'types' });
  if (location.level === 'neighborhood') breadcrumbs.push({ label: focus?.label ?? 'Neighborhood', level: 'neighborhood', nodeId: location.focusNodeId });
  return breadcrumbs;
}

function namespaceNames(source: GraphProjection): readonly string[] {
  return [...new Set(source.nodes.filter((node) => node.kind !== 'namespace').map(normalizedNamespace))].sort();
}

function normalizedNamespace(node: GraphNode): string {
  return node.namespace && node.namespace !== 'root' ? node.namespace : node.kind === 'document' ? 'Document' : 'Definitions';
}

function atlasNodeId(namespace: string): string {
  return `graph:namespace:${encodeURIComponent(namespace)}`;
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
