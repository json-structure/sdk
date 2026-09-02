import type { ProjectionId } from '../graph.js';
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
  readonly recentPath: readonly { readonly index: number; readonly label: string; readonly current: boolean }[];
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
    if (!this.selection) this.selection = defaultSelection(source, this.location.lens);
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
    this.location = lens === 'relations'
      ? { ...this.location, lens }
      : { level: 'atlas', lens };
    this.selection = defaultSelection(this.source, lens);
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

  public revealNode(nodeId: string): SemanticGraphView {
    const node = this.source.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return this.view();
    const namespace = normalizedNamespace(node);
    if (this.location.level === 'atlas' || this.location.namespace !== namespace) {
      this.navigate({ level: 'types', lens: this.location.lens, namespace }, selectionForNode(node));
    } else {
      this.selection = selectionForNode(node);
    }
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
    if (this.location.lens === 'extends' || this.location.lens === 'imports') {
      this.selection = selectionForNode(node);
    } else if (this.location.level === 'atlas') {
      const namespace = namespaceFromAtlasNode(node);
      const initialType = this.location.lens === 'relations'
        ? this.source.nodes.find((candidate) => candidate.kind === 'type' && normalizedNamespace(candidate) === namespace && candidate.label === 'Place')
          ?? this.source.nodes.find((candidate) => candidate.kind === 'type' && normalizedNamespace(candidate) === namespace)
        : undefined;
      this.navigate({ level: 'types', lens: this.location.lens, namespace }, selectionForNode(initialType ?? node));
    } else if (this.location.lens === 'relations' && this.location.level === 'types') {
      this.navigate({ level: 'neighborhood', lens: this.location.lens, namespace: this.location.namespace ?? normalizedNamespace(node), focusNodeId: sourceNodeId(node) }, selectionForNode(node));
    } else {
      this.selection = selectionForNode(node);
    }
    return this.view();
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
    return this.view();
  }

  public home(): SemanticGraphView {
    if (this.location.level !== 'atlas') this.navigate({ level: 'atlas', lens: this.location.lens }, defaultSelection(this.source, this.location.lens));
    return this.view();
  }

  public back(): SemanticGraphView {
    if (this.historyIndex > 0) {
      this.historyIndex -= 1;
      const entry = this.history[this.historyIndex]!;
      this.location = { ...entry.location, lens: this.location.lens };
      this.selection = entry.selection;
    }
    return this.view();
  }

  public forward(): SemanticGraphView {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      const entry = this.history[this.historyIndex]!;
      this.location = { ...entry.location, lens: this.location.lens };
      this.selection = entry.selection;
    }
    return this.view();
  }

  public view(): SemanticGraphView {
    const projection = projectionForLocation(this.source, this.location);
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
      recentPath: this.history.map((entry, index) => ({ index, label: historyLabel(entry.location, this.source), current: index === this.historyIndex })).slice(-6).reverse(),
    };
  }

  public restore(index: number): SemanticGraphView {
    if (index < 0 || index >= this.history.length) return this.view();
    this.historyIndex = index;
    const entry = this.history[index]!;
    this.location = { ...entry.location, lens: this.location.lens };
    this.selection = entry.selection;
    return this.view();
  }

  private navigate(location: SemanticGraphLocation, selection: SelectionIdentity | undefined): void {
    if (sameLocation(this.location, location) && this.selection?.nodeId === selection?.nodeId) return;
    const entry = { location, selection };
    this.location = location;
    this.selection = selection;
    this.history = this.historyIndex >= 0 ? this.history.slice(0, this.historyIndex + 1) : [];
    this.history.push(entry);
    this.historyIndex = this.history.length - 1;
  }
}

function projectionForLocation(source: GraphProjection, location: SemanticGraphLocation): GraphProjection {
  if (location.lens === 'namespaces' && location.level === 'atlas') return namespaceAtlasProjection(source);
  if (location.level === 'atlas') return atlasProjection(source, location.lens);
  const lensProjection = typeProjection(source, location.lens, location.namespace);
  if (location.level !== 'neighborhood' || !location.focusNodeId) return lensProjection;
  return location.lens === 'relations' ? outgoingRelationNeighborhood(source, location.focusNodeId) : lensProjection;
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
  return {
    nodes: source.nodes.filter((node) => primary.has(node.id)),
    edges: edges.filter((edge) => primary.has(edge.from) && primary.has(edge.to)),
  };
}

function namespaceAtlasProjection(source: GraphProjection): GraphProjection {
  const namespaces = namespaceNames(source);
  const documentNode: GraphNode = { id: 'graph:document-root', pointer: '', label: 'Document root', namespace: '', kind: 'document', status: 'resolved', selectable: true };
  const namespaceNodes = namespaces.map(atlasNodeFor);
  return {
    nodes: [documentNode, ...namespaceNodes],
    edges: namespaceNodes.map((node) => ({ id: `graph:root:${node.id}`, from: documentNode.id, to: node.id, label: 'contains', kind: 'root', selectable: false })),
  };
}

function outgoingRelationNeighborhood(source: GraphProjection, focusNodeId: string): GraphProjection {
  const relationEdges = source.edges.filter((edge) => edge.kind === 'relation' && edge.from === focusNodeId);
  const grouped = new Map<string, GraphEdge[]>();
  relationEdges.forEach((edge) => grouped.set(edge.to, [...(grouped.get(edge.to) ?? []), edge]));
  const visible = new Set([focusNodeId, ...grouped.keys()]);
  const edges = [...grouped.entries()].map(([target, entries]) => {
    const representative = entries[0]!;
    return {
      ...representative,
      id: `graph:relation-bundle:${encodeURIComponent(focusNodeId)}:${encodeURIComponent(target)}`,
      label: entries.length === 1 ? representative.label : `${entries.length} relations`,
      target,
    };
  });
  return { nodes: source.nodes.filter((node) => visible.has(node.id)), edges };
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
  return [...new Set(source.nodes.filter((node) => node.kind === 'type').map(normalizedNamespace))].sort();
}

function normalizedNamespace(node: GraphNode): string {
  return node.namespace && node.namespace !== 'root' ? node.namespace : node.kind === 'document' ? 'Document' : 'Definitions';
}

function atlasNodeId(namespace: string): string {
  return `graph:namespace:${encodeURIComponent(namespace)}`;
}

function atlasNodeFor(namespace: string): GraphNode {
  return { id: atlasNodeId(namespace), pointer: '', label: namespace, namespace, kind: 'namespace', status: 'resolved', selectable: true };
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
  return left.level === right.level && left.lens === right.lens && left.namespace === right.namespace && left.focusNodeId === right.focusNodeId;
}

function historyLabel(location: SemanticGraphLocation, source: GraphProjection): string {
  if (location.level === 'atlas') return 'Atlas';
  if (location.level === 'types') return location.namespace ?? 'Types';
  return source.nodes.find((node) => node.id === location.focusNodeId)?.label ?? 'Neighborhood';
}
